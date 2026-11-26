#include <windows.h>
#include <winternl.h>
#include <aclapi.h>
#include <sddl.h>
#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr size_t kMaxBytes = 1024 * 1024;
constexpr size_t kMaxPathUnits = 4096;
constexpr ULONG kFileOpen = 1;
constexpr ULONG kFileCreate = 2;
constexpr ULONG kDirectoryFile = 0x00000001;
constexpr ULONG kSynchronousNonAlert = 0x00000020;
constexpr ULONG kNonDirectoryFile = 0x00000040;
constexpr ULONG kOpenReparsePoint = 0x00200000;
constexpr ULONG kCaseInsensitive = 0x00000040;
// FILE_LIST_DIRECTORY is a read access for sharing enforcement. Metadata-only
// access does not establish the same sharing boundary.
constexpr ACCESS_MASK kDirectoryAccess = READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | SYNCHRONIZE;
#ifdef PANELREPLY_STORAGE_TEST_PROBE
const napi_type_tag kLeaseTag = {0xd4eebf9a6d5a43aaULL, 0xb6b822840c5cb62fULL};
#else
const napi_type_tag kLeaseTag = {0x5abde5b590cd4a95ULL, 0xb9bc5a27ec964383ULL};
#endif

struct Failure : std::runtime_error {
  const char* code;
  DWORD systemCode;
  Failure(const char* codeValue, const char* message, DWORD systemValue = 0)
      : std::runtime_error(message), code(codeValue), systemCode(systemValue) {}
};

struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  Handle() = default;
  explicit Handle(HANDLE handle) : value(handle) {}
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) { close(); value = std::exchange(other.value, INVALID_HANDLE_VALUE); }
    return *this;
  }
  ~Handle() { close(); }
  void close() noexcept {
    if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value);
    value = INVALID_HANDLE_VALUE;
  }
};

struct LocalAllocation {
  void* value = nullptr;
  ~LocalAllocation() { if (value) LocalFree(value); }
  LocalAllocation() = default;
  LocalAllocation(const LocalAllocation&) = delete;
  LocalAllocation& operator=(const LocalAllocation&) = delete;
};

void check(bool condition, const char* code, const char* message) {
  if (!condition) throw Failure(code, message, GetLastError());
}
void napiCheck(napi_status status) {
  if (status != napi_ok) throw Failure("NATIVE_BINDING_ERROR", "The native storage binding could not complete the operation.");
}

template <typename Function> Function systemFunction(const char* name) {
  const HMODULE module = GetModuleHandleW(L"ntdll.dll");
  check(module != nullptr, "NATIVE_API_UNAVAILABLE", "The Windows native API module is unavailable.");
  const FARPROC address = GetProcAddress(module, name);
  check(address != nullptr, "NATIVE_API_UNAVAILABLE", "A required documented Windows native API is unavailable.");
  static_assert(sizeof(Function) == sizeof(address));
  Function function;
  std::memcpy(&function, &address, sizeof(function));
  return function;
}

using NtCreateFileFunction = NTSTATUS (NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
    PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using StatusToErrorFunction = ULONG (WINAPI *)(NTSTATUS);

Handle nativeOpen(HANDLE parent, const std::wstring& name, ACCESS_MASK access,
                  ULONG disposition, ULONG options, PSECURITY_DESCRIPTOR descriptor = nullptr) {
  if (name.empty() || name.size() > kMaxPathUnits + 8) throw Failure("INVALID_PATH", "The native path exceeds the component limit.");
  UNICODE_STRING objectName{};
  objectName.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t));
  objectName.MaximumLength = objectName.Length;
  objectName.Buffer = const_cast<PWSTR>(name.data());
  OBJECT_ATTRIBUTES attributes{};
  attributes.Length = sizeof(attributes);
  attributes.RootDirectory = parent;
  attributes.ObjectName = &objectName;
  attributes.Attributes = kCaseInsensitive;
  attributes.SecurityDescriptor = descriptor;
  IO_STATUS_BLOCK io{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  const NTSTATUS status = systemFunction<NtCreateFileFunction>("NtCreateFile")(
      &raw, access, &attributes, &io, nullptr, FILE_ATTRIBUTE_NORMAL,
      FILE_SHARE_READ, disposition, options | kSynchronousNonAlert | kOpenReparsePoint, nullptr, 0);
  if (status < 0) {
    const DWORD error = systemFunction<StatusToErrorFunction>("RtlNtStatusToDosError")(status);
    const char* code = error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS
        ? "PATH_EXISTS" : "NATIVE_OPEN_FAILED";
    throw Failure(code, "Windows refused the protected path operation.", error);
  }
  return Handle(raw);
}

std::wstring finalPath(HANDLE handle, DWORD flags) {
  const DWORD needed = GetFinalPathNameByHandleW(handle, nullptr, 0, flags);
  check(needed > 0 && needed <= kMaxPathUnits + 64, "INVALID_PATH", "The opened object has no bounded canonical path.");
  std::vector<wchar_t> value(static_cast<size_t>(needed) + 1);
  const DWORD length = GetFinalPathNameByHandleW(handle, value.data(), static_cast<DWORD>(value.size()), flags);
  check(length > 0 && length < value.size(), "INVALID_PATH", "The canonical path could not be read.");
  return std::wstring(value.data(), length);
}
bool sameName(const std::wstring& left, const std::wstring& right) {
  return CompareStringOrdinal(left.data(), static_cast<int>(left.size()), right.data(),
                              static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}
std::wstring lastComponent(const std::wstring& path) {
  const size_t separator = path.find_last_of(L'\\');
  return separator == std::wstring::npos ? path : path.substr(separator + 1);
}

void validateUnicode(const std::wstring& value) {
  for (size_t index = 0; index < value.size(); ++index) {
    const wchar_t unit = value[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index == value.size() || value[index] < 0xdc00 || value[index] > 0xdfff)
        throw Failure("INVALID_PATH", "The path must contain well-formed Unicode.");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw Failure("INVALID_PATH", "The path must contain well-formed Unicode.");
    }
  }
}
void validateName(const std::wstring& name) {
  validateUnicode(name);
  if (name.empty() || name.size() > 255 || name == L"." || name == L".." ||
      name.back() == L'.' || name.back() == L' ')
    throw Failure("INVALID_PATH", "Use one bounded child name without traversal or trailing dots or spaces.");
  for (const wchar_t unit : name) {
    if (unit < 32 || unit == 127 || std::wstring(L"\\/:*?\"<>|").find(unit) != std::wstring::npos)
      throw Failure("INVALID_PATH", "Streams, separators, device syntax and control characters are not supported.");
  }
  std::wstring stem = name.substr(0, name.find(L'.'));
  std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t unit) {
    return unit >= L'a' && unit <= L'z' ? static_cast<wchar_t>(unit - L'a' + L'A') : unit;
  });
  if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
      stem == L"CONIN$" || stem == L"CONOUT$" ||
      (stem.size() == 4 && (stem.substr(0, 3) == L"COM" || stem.substr(0, 3) == L"LPT") &&
       ((stem[3] >= L'0' && stem[3] <= L'9') || stem[3] == 0x00b9 || stem[3] == 0x00b2 || stem[3] == 0x00b3)))
    throw Failure("INVALID_PATH", "Reserved DOS device names are not supported.");
}
std::vector<std::wstring> pathComponents(const std::wstring& path) {
  validateUnicode(path);
  if (path.size() < 4 || path.size() > kMaxPathUnits ||
      !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) ||
      path[1] != L':' || path[2] != L'\\')
    throw Failure("INVALID_PATH", "Use a fully qualified local DOS path below a volume root.");
  std::vector<std::wstring> result;
  size_t start = 3;
  while (start <= path.size()) {
    const size_t separator = path.find(L'\\', start);
    const std::wstring component = path.substr(start, separator == std::wstring::npos ? separator : separator - start);
    validateName(component);
    result.push_back(component);
    if (separator == std::wstring::npos) break;
    start = separator + 1;
  }
  return result;
}

std::vector<unsigned char> currentUser() {
  HANDLE thread = nullptr;
  if (OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &thread)) {
    Handle token(thread);
    throw Failure("UNSUPPORTED_TOKEN", "This component does not run under a thread impersonation token.");
  }
  if (GetLastError() != ERROR_NO_TOKEN)
    throw Failure("UNSUPPORTED_TOKEN", "The current thread token could not be verified.", GetLastError());
  HANDLE raw = nullptr;
  check(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw) != FALSE,
        "TOKEN_UNAVAILABLE", "The process user SID could not be read.");
  Handle token(raw);
  DWORD required = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &required);
  check(required >= sizeof(TOKEN_USER) && required <= 65536, "TOKEN_UNAVAILABLE", "The process user SID size is invalid.");
  std::vector<unsigned char> buffer(required);
  check(GetTokenInformation(token.value, TokenUser, buffer.data(), required, &required) != FALSE,
        "TOKEN_UNAVAILABLE", "The process user SID could not be read.");
  const auto user = reinterpret_cast<TOKEN_USER*>(buffer.data());
  check(IsValidSid(user->User.Sid) != FALSE, "TOKEN_UNAVAILABLE", "The process user SID is invalid.");
  std::vector<unsigned char> sid(GetLengthSid(user->User.Sid));
  check(CopySid(static_cast<DWORD>(sid.size()), sid.data(), user->User.Sid) != FALSE,
        "TOKEN_UNAVAILABLE", "The process user SID could not be copied.");
  return sid;
}
std::wstring sidText(PSID sid) {
  LPWSTR text = nullptr;
  check(ConvertSidToStringSidW(sid, &text) != FALSE, "INVALID_SECURITY", "A security SID could not be serialized.");
  LocalAllocation memory;
  memory.value = text;
  return std::wstring(text);
}
struct Descriptor {
  LocalAllocation memory;
  explicit Descriptor(const std::vector<unsigned char>& user, bool directory) {
    const std::wstring sid = sidText(const_cast<unsigned char*>(user.data()));
    const std::wstring sddl = L"O:" + sid + L"D:P(A;" + (directory ? L"OICI" : L"") + L";FA;;;" + sid + L")";
    PSECURITY_DESCRIPTOR value = nullptr;
    check(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &value, nullptr) != FALSE,
          "INVALID_SECURITY", "The private creation descriptor could not be prepared.");
    memory.value = value;
  }
  PSECURITY_DESCRIPTOR get() const { return memory.value; }
};

struct Identity {
  FILE_ID_INFO id{};
  FILE_STANDARD_INFO standard{};
};
Identity identity(HANDLE handle, bool directory) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  check(GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes)) != FALSE,
        "INVALID_OBJECT", "The opened object's attributes could not be verified.");
  if ((attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
    throw Failure("REPARSE_POINT", "Reparse points are not permitted in private storage.");
  if (GetFileType(handle) != FILE_TYPE_DISK)
    throw Failure("INVALID_OBJECT", "Only local disk filesystem objects are permitted.");
  Identity result;
  check(GetFileInformationByHandleEx(handle, FileIdInfo, &result.id, sizeof(result.id)) != FALSE &&
        GetFileInformationByHandleEx(handle, FileStandardInfo, &result.standard, sizeof(result.standard)) != FALSE,
        "INVALID_OBJECT", "The opened object's identity could not be verified.");
  if ((result.standard.Directory != FALSE) != directory || result.standard.DeletePending ||
      result.standard.EndOfFile.QuadPart < 0 || (!directory && result.standard.NumberOfLinks != 1))
    throw Failure("INVALID_OBJECT", "The object type, deletion state or link count is unsafe.");
  return result;
}
bool sameIdentity(const FILE_ID_INFO& left, const FILE_ID_INFO& right) {
  return left.VolumeSerialNumber == right.VolumeSerialNumber &&
      std::memcmp(left.FileId.Identifier, right.FileId.Identifier, sizeof(left.FileId.Identifier)) == 0;
}
std::wstring privateSecurity(HANDLE handle, const std::vector<unsigned char>& user, bool directory) {
  PSID owner = nullptr;
  PACL dacl = nullptr;
  PSECURITY_DESCRIPTOR raw = nullptr;
  const DWORD status = GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                                      &owner, nullptr, &dacl, nullptr, &raw);
  LocalAllocation memory;
  memory.value = raw;
  if (status != ERROR_SUCCESS) throw Failure("INVALID_SECURITY", "The object's owner and DACL could not be read.", status);
  if (!owner || !IsValidSid(owner) || !EqualSid(owner, const_cast<unsigned char*>(user.data())))
    throw Failure("WRONG_OWNER", "The object owner must equal the current process user SID.");
  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0;
  BOOL present = FALSE, defaulted = FALSE;
  check(GetSecurityDescriptorControl(raw, &control, &revision) != FALSE &&
        GetSecurityDescriptorDacl(raw, &present, &dacl, &defaulted) != FALSE,
        "INVALID_SECURITY", "The object's DACL state could not be verified.");
  if (!present || dacl == nullptr || !IsValidAcl(dacl) || !(control & SE_DACL_PROTECTED) || dacl->AceCount != 1)
    throw Failure("UNSAFE_DACL", "Use a protected owner-only DACL with an explicit owner grant.");
  void* entry = nullptr;
  check(GetAce(dacl, 0, &entry) != FALSE, "UNSAFE_DACL", "The object's owner grant could not be read.");
  const auto header = static_cast<ACE_HEADER*>(entry);
  const BYTE expectedFlags = static_cast<BYTE>(directory ? OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE : 0);
  if (header->AceType != ACCESS_ALLOWED_ACE_TYPE || header->AceFlags != expectedFlags ||
      header->AceSize < offsetof(ACCESS_ALLOWED_ACE, SidStart) + 8)
    throw Failure("UNSAFE_DACL", "The DACL contains an unsupported access entry.");
  const auto ace = static_cast<ACCESS_ALLOWED_ACE*>(entry);
  PSID grant = &ace->SidStart;
  if (!IsValidSid(grant) ||
      static_cast<size_t>(header->AceSize) < offsetof(ACCESS_ALLOWED_ACE, SidStart) + GetLengthSid(grant) ||
      ace->Mask != FILE_ALL_ACCESS || !EqualSid(grant, owner))
    throw Failure("UNSAFE_DACL", "The DACL must grant full access only to the owner user SID.");
  return sidText(owner);
}

struct HeldDirectory {
  Handle handle;
  FILE_ID_INFO expected{};
};
struct Lease {
  std::vector<HeldDirectory> chain;
  std::vector<unsigned char> user;
  std::wstring path;
  std::wstring volume;
  bool closed = false;
  ~Lease() { close(); }
  void close() noexcept { closed = true; chain.clear(); }
  HANDLE root() const { return chain.back().handle.value; }
  Identity validate() const {
    if (closed || chain.empty()) throw Failure("CLOSED_LEASE", "This private directory lease is closed.");
    const auto actor = currentUser();
    if (!EqualSid(const_cast<unsigned char*>(actor.data()), const_cast<unsigned char*>(user.data())))
      throw Failure("UNSUPPORTED_TOKEN", "The process user changed after the lease was opened.");
    Identity result;
    for (const auto& directory : chain) {
      result = identity(directory.handle.value, true);
      if (!sameIdentity(result.id, directory.expected))
        throw Failure("IDENTITY_CHANGED", "A retained directory identity changed.");
    }
    privateSecurity(root(), user, true);
    return result;
  }
};
struct Environment {
  std::vector<std::weak_ptr<Lease>> leases;
};
struct WrappedLease { std::shared_ptr<Lease> lease; };

DWORD removeCreated(HANDLE handle) noexcept {
  FILE_DISPOSITION_INFO disposition{};
  disposition.DeleteFile = TRUE;
  return SetFileInformationByHandle(handle, FileDispositionInfo, &disposition, sizeof(disposition))
      ? ERROR_SUCCESS : GetLastError();
}
void cleanupCreated(HANDLE handle) {
  const DWORD error = removeCreated(handle);
  if (error != ERROR_SUCCESS)
    throw Failure("CREATE_CLEANUP_FAILED", "The failed operation left a newly created private artifact. Its cleanup could not be confirmed.", error);
}
std::shared_ptr<Lease> openDirectory(const std::wstring& path, bool create) {
  const auto parts = pathComponents(path);
  auto result = std::make_shared<Lease>();
  result->user = currentUser();
  result->path = path;
  Handle drive = nativeOpen(nullptr, L"\\??\\" + path.substr(0, 3), kDirectoryAccess, kFileOpen, 0);
  const Identity rootIdentity = identity(drive.value, true);
  wchar_t filesystem[32]{};
  DWORD volumeFlags = 0;
  check(GetVolumeInformationByHandleW(drive.value, nullptr, 0, nullptr, nullptr, &volumeFlags,
                                    filesystem, static_cast<DWORD>(std::size(filesystem))) != FALSE,
        "UNSUPPORTED_VOLUME", "The opened volume could not be inspected.");
  result->volume = finalPath(drive.value, VOLUME_NAME_GUID);
  if (std::wstring(filesystem) != L"NTFS" || !(volumeFlags & FILE_PERSISTENT_ACLS) ||
      result->volume.rfind(L"\\\\?\\Volume{", 0) != 0 || GetDriveTypeW(result->volume.c_str()) != DRIVE_FIXED)
    throw Failure("UNSUPPORTED_VOLUME", "This component requires an observed fixed local NTFS volume with persistent ACLs.");
  if (!sameName(finalPath(drive.value, VOLUME_NAME_DOS), L"\\\\?\\" + path.substr(0, 3)))
    throw Failure("PATH_ALIAS", "Drive aliases are not supported by this component.");
  result->chain.push_back({std::move(drive), rootIdentity.id});
  for (size_t index = 0; index < parts.size(); ++index) {
    const bool last = index + 1 == parts.size();
    const bool creating = create && last;
    Descriptor security(result->user, true);
    Handle child = nativeOpen(result->root(), parts[index], kDirectoryAccess | (creating ? DELETE : 0),
                              creating ? kFileCreate : kFileOpen, creating ? kDirectoryFile : 0,
                              creating ? security.get() : nullptr);
    try {
      const Identity checked = identity(child.value, true);
      if (checked.id.VolumeSerialNumber != rootIdentity.id.VolumeSerialNumber)
        throw Failure("UNSUPPORTED_VOLUME", "A path component changed the opened volume.");
      if (!sameName(lastComponent(finalPath(child.value, VOLUME_NAME_GUID)), parts[index]))
        throw Failure("PATH_ALIAS", "Short-name aliases are not supported by this component.");
      if (last) privateSecurity(child.value, result->user, true);
      result->chain.push_back({std::move(child), checked.id});
    } catch (...) {
      if (creating) cleanupCreated(child.value);
      throw;
    }
  }
  try { result->validate(); }
  catch (...) {
    if (create) cleanupCreated(result->root());
    throw;
  }
  return result;
}

napi_value jsString(napi_env env, const std::wstring& value) {
  napi_value result;
  static_assert(sizeof(wchar_t) == sizeof(char16_t));
  napiCheck(napi_create_string_utf16(env, reinterpret_cast<const char16_t*>(value.data()), value.size(), &result));
  return result;
}
napi_value jsString(napi_env env, const char* value) {
  napi_value result;
  napiCheck(napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result));
  return result;
}
void property(napi_env env, napi_value object, const char* name, napi_value value) {
  napiCheck(napi_set_named_property(env, object, name, value));
}
napi_value number(napi_env env, double value) {
  napi_value result;
  napiCheck(napi_create_double(env, value, &result));
  return result;
}
napi_value boolean(napi_env env, bool value) {
  napi_value result;
  napiCheck(napi_get_boolean(env, value, &result));
  return result;
}
std::wstring argumentString(napi_env env, napi_value value) {
  napi_valuetype type;
  napiCheck(napi_typeof(env, value, &type));
  if (type != napi_string) throw Failure("INVALID_ARGUMENT", "A path argument must be a string.");
  size_t length = 0;
  napiCheck(napi_get_value_string_utf16(env, value, nullptr, 0, &length));
  if (length > kMaxPathUnits) throw Failure("INVALID_PATH", "The path exceeds the component limit.");
  std::vector<char16_t> units(length + 1);
  napiCheck(napi_get_value_string_utf16(env, value, units.data(), units.size(), &length));
  return std::wstring(reinterpret_cast<const wchar_t*>(units.data()), length);
}
napi_value metadata(napi_env env, HANDLE handle, const std::vector<unsigned char>& user, bool directory) {
  const Identity info = identity(handle, directory);
  if (!directory && info.standard.EndOfFile.QuadPart > static_cast<LONGLONG>(kMaxBytes))
    throw Failure("FILE_TOO_LARGE", "This component inspects files of at most 1 MiB.");
  const std::wstring owner = privateSecurity(handle, user, directory);
  static constexpr wchar_t hex[] = L"0123456789abcdef";
  std::wstring fileId;
  for (const unsigned char byte : info.id.FileId.Identifier) { fileId += hex[byte >> 4]; fileId += hex[byte & 15]; }
  napi_value result;
  napiCheck(napi_create_object(env, &result));
  property(env, result, "ownerSid", jsString(env, owner));
  property(env, result, "currentUserSid", jsString(env, sidText(const_cast<unsigned char*>(user.data()))));
  property(env, result, "ownerOnly", boolean(env, true));
  property(env, result, "protectedDacl", boolean(env, true));
  property(env, result, "type", jsString(env, directory ? "directory" : "file"));
  property(env, result, "fileId", jsString(env, fileId));
  property(env, result, "volumeSerial", jsString(env, std::to_wstring(info.id.VolumeSerialNumber)));
  property(env, result, "links", number(env, info.standard.NumberOfLinks));
  property(env, result, "bytes", number(env, static_cast<double>(info.standard.EndOfFile.QuadPart)));
  return result;
}
void childName(HANDLE handle, const Lease& lease, const std::wstring& name) {
  const Identity info = identity(handle, false);
  if (info.id.VolumeSerialNumber != lease.chain.front().expected.VolumeSerialNumber)
    throw Failure("UNSUPPORTED_VOLUME", "A child file is outside the checked volume.");
  if (!sameName(lastComponent(finalPath(handle, VOLUME_NAME_GUID)), name))
    throw Failure("PATH_ALIAS", "Short-name child aliases are not supported by this component.");
}

template <typename Function> napi_value protect(napi_env env, Function function) {
  try { return function(); }
  catch (const Failure& error) {
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    napi_value original = nullptr;
    // A probe callback can throw before rollback. Preserve that exception as a
    // cause, but never hide a failed same-handle cleanup behind the callback.
    if (pending && std::strcmp(error.code, "CREATE_CLEANUP_FAILED") == 0) {
      if (napi_get_and_clear_last_exception(env, &original) == napi_ok) pending = false;
    }
    if (!pending) {
      napi_value result, message, code, system;
      napi_create_string_utf8(env, error.what(), NAPI_AUTO_LENGTH, &message);
      napi_create_string_utf8(env, error.code, NAPI_AUTO_LENGTH, &code);
      napi_create_error(env, code, message, &result);
      napi_create_uint32(env, error.systemCode, &system);
      napi_set_named_property(env, result, "win32Code", system);
      if (original) napi_set_named_property(env, result, "cause", original);
      napi_throw(env, result);
    }
  } catch (const std::exception&) {
    napi_throw_error(env, "NATIVE_STORAGE_ERROR", "The native storage component could not complete the operation.");
  }
  return nullptr;
}
struct Call {
  napi_env env;
  napi_value self;
  // One spare slot ensures a caller cannot hide extra arguments beyond the
  // documented maximum, even when napi_get_cb_info caps the copied count.
  napi_value args[4]{};
  void* data = nullptr;
  size_t count = 4;
  explicit Call(napi_env environment, napi_callback_info info) : env(environment) {
    napiCheck(napi_get_cb_info(env, info, &count, args, &self, &data));
  }
  void arguments(size_t required) const {
    if (count != required) throw Failure("INVALID_ARGUMENT", "Use the exact documented arguments for this component operation.");
  }
  std::shared_ptr<Lease> lease(bool closedAllowed = false) const {
    bool correct = false;
    napi_valuetype type;
    napiCheck(napi_typeof(env, self, &type));
    if (type == napi_object) napiCheck(napi_check_object_type_tag(env, self, &kLeaseTag, &correct));
    if (!correct) throw Failure("INVALID_RECEIVER", "Call this method on its native directory lease.");
    void* raw = nullptr;
    napiCheck(napi_unwrap(env, self, &raw));
    if (!raw) throw Failure("INVALID_RECEIVER", "The native directory lease is invalid.");
    auto result = static_cast<WrappedLease*>(raw)->lease;
    if (!closedAllowed) result->validate();
    return result;
  }
};

#ifdef PANELREPLY_STORAGE_TEST_PROBE
// Test-only callbacks observe the actual handle before any payload write. They
// expose no handle capable of IO. The normal artifact contains neither callback
// path and rejects the third argument. The fixture's observer process performs
// read-only snapshots of independently held source/redirect directories.
void createProbe(const Call& call, const char* phase, HANDLE handle = INVALID_HANDLE_VALUE) {
  napi_valuetype type;
  napiCheck(napi_typeof(call.env, call.args[2], &type));
  if (type != napi_function) throw Failure("INVALID_ARGUMENT", "The test probe requires an observation callback.");
  napi_value event;
  napiCheck(napi_create_object(call.env, &event));
  property(call.env, event, "phase", jsString(call.env, phase));
  if (handle != INVALID_HANDLE_VALUE) {
    const Identity observed = identity(handle, false);
    static constexpr wchar_t hex[] = L"0123456789abcdef";
    std::wstring identifier;
    for (const unsigned char byte : observed.id.FileId.Identifier) {
      identifier += hex[byte >> 4]; identifier += hex[byte & 15];
    }
    property(call.env, event, "canonicalPath", jsString(call.env, finalPath(handle, VOLUME_NAME_GUID)));
    property(call.env, event, "fileId", jsString(call.env, identifier));
    property(call.env, event, "volumeSerial", jsString(call.env, std::to_wstring(observed.id.VolumeSerialNumber)));
    property(call.env, event, "bytes", number(call.env, static_cast<double>(observed.standard.EndOfFile.QuadPart)));
  }
  napiCheck(napi_object_freeze(call.env, event));
  napi_value ignored;
  napiCheck(napi_call_function(call.env, call.self, call.args[2], 1, &event, &ignored));
}
void requireLiveProbeLease(const std::shared_ptr<Lease>& lease) {
  if (lease->closed || lease->chain.empty()) throw Failure("CLOSED_LEASE", "The test callback closed its lease.");
}
#endif

napi_value inspect(napi_env env, napi_callback_info info) {
  return protect(env, [&] {
    Call call(env, info); call.arguments(0);
    const auto lease = call.lease();
    napi_value result = metadata(env, lease->root(), lease->user, true);
    property(env, result, "filesystem", jsString(env, "NTFS"));
    property(env, result, "volumeGuidPath", jsString(env, lease->volume));
    property(env, result, "path", jsString(env, lease->path));
    return result;
  });
}
napi_value closeLease(napi_env env, napi_callback_info info) {
  return protect(env, [&] {
    Call call(env, info); call.arguments(0); call.lease(true)->close();
    napi_value result; napiCheck(napi_get_undefined(env, &result)); return result;
  });
}
napi_value createFile(napi_env env, napi_callback_info info) {
  return protect(env, [&] {
    Call call(env, info);
#ifdef PANELREPLY_STORAGE_TEST_PROBE
    call.arguments(3);
#else
    call.arguments(2);
#endif
    const auto lease = call.lease();
    const std::wstring name = argumentString(env, call.args[0]); validateName(name);
    bool buffer = false;
    napiCheck(napi_is_buffer(env, call.args[1], &buffer));
    if (!buffer) throw Failure("INVALID_ARGUMENT", "File bytes must be a Buffer.");
    void* bytes = nullptr; size_t length = 0;
    napiCheck(napi_get_buffer_info(env, call.args[1], &bytes, &length));
    if (length > kMaxBytes) throw Failure("FILE_TOO_LARGE", "This component creates at most 1 MiB per file.");
    std::vector<unsigned char> payload(length);
    if (length) std::memcpy(payload.data(), bytes, length);
    Descriptor descriptor(lease->user, false);
#ifdef PANELREPLY_STORAGE_TEST_PROBE
    createProbe(call, "beforeOpen");
    requireLiveProbeLease(lease);
#endif
    Handle file = nativeOpen(lease->root(), name, GENERIC_READ | GENERIC_WRITE | READ_CONTROL | DELETE | SYNCHRONIZE,
                            kFileCreate, kNonDirectoryFile, descriptor.get());
    try {
#ifdef PANELREPLY_STORAGE_TEST_PROBE
      createProbe(call, "opened", file.value);
      requireLiveProbeLease(lease);
#endif
      childName(file.value, *lease, name); privateSecurity(file.value, lease->user, false);
      DWORD written = 0;
      check(WriteFile(file.value, payload.data(), static_cast<DWORD>(length), &written, nullptr) != FALSE && written == length,
            "WRITE_FAILED", "The protected file bytes could not be written.");
      check(FlushFileBuffers(file.value) != FALSE, "FLUSH_FAILED", "Windows did not confirm the protected file flush.");
      lease->validate();
      return metadata(env, file.value, lease->user, false);
    } catch (...) { cleanupCreated(file.value); throw; }
  });
}
napi_value inspectFile(napi_env env, napi_callback_info info) {
  return protect(env, [&] {
    Call call(env, info); call.arguments(1);
    const auto lease = call.lease();
    const std::wstring name = argumentString(env, call.args[0]); validateName(name);
    Handle file = nativeOpen(lease->root(), name, READ_CONTROL | FILE_READ_ATTRIBUTES | SYNCHRONIZE, kFileOpen, 0);
    childName(file.value, *lease, name);
    napi_value result = metadata(env, file.value, lease->user, false);
    lease->validate();
    return result;
  });
}
napi_value readFile(napi_env env, napi_callback_info info) {
  return protect(env, [&] {
    Call call(env, info); call.arguments(2);
    const auto lease = call.lease();
    const std::wstring name = argumentString(env, call.args[0]); validateName(name);
    napi_valuetype type;
    napiCheck(napi_typeof(env, call.args[1], &type));
    double maximum = 0;
    if (type != napi_number) throw Failure("INVALID_ARGUMENT", "A bounded byte limit is required.");
    napiCheck(napi_get_value_double(env, call.args[1], &maximum));
    if (!std::isfinite(maximum) || std::floor(maximum) != maximum || maximum < 0 || maximum > kMaxBytes)
      throw Failure("INVALID_ARGUMENT", "The read limit must be an integer from zero through 1 MiB.");
    Handle file = nativeOpen(lease->root(), name, GENERIC_READ | READ_CONTROL | SYNCHRONIZE, kFileOpen, 0);
    childName(file.value, *lease, name);
    const Identity before = identity(file.value, false); privateSecurity(file.value, lease->user, false);
    if (before.standard.EndOfFile.QuadPart > static_cast<LONGLONG>(maximum)) throw Failure("FILE_TOO_LARGE", "The private file exceeds the caller's byte limit.");
    std::vector<unsigned char> bytes(static_cast<size_t>(before.standard.EndOfFile.QuadPart));
    DWORD read = 0;
    check(ReadFile(file.value, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr) != FALSE && read == bytes.size(),
          "READ_FAILED", "The protected file bytes could not be read completely.");
    const Identity after = identity(file.value, false);
    if (!sameIdentity(before.id, after.id) || before.standard.EndOfFile.QuadPart != after.standard.EndOfFile.QuadPart)
      throw Failure("IDENTITY_CHANGED", "The protected file changed during the read.");
    privateSecurity(file.value, lease->user, false); lease->validate();
    napi_value result;
    napiCheck(napi_create_buffer_copy(env, bytes.size(), bytes.data(), nullptr, &result));
    return result;
  });
}

void finalizeLease(napi_env, void* data, void*) { delete static_cast<WrappedLease*>(data); }
napi_value directoryCall(napi_env env, napi_callback_info info, bool create) {
  return protect(env, [&] {
    Call call(env, info); call.arguments(1);
    auto lease = openDirectory(argumentString(env, call.args[0]), create);
    try {
    napi_value result; napiCheck(napi_create_object(env, &result));
    const napi_property_descriptor methods[] = {
      {"inspect", nullptr, inspect, nullptr, nullptr, nullptr, napi_default_method, nullptr},
      {"createFile", nullptr, createFile, nullptr, nullptr, nullptr, napi_default_method, nullptr},
      {"inspectFile", nullptr, inspectFile, nullptr, nullptr, nullptr, napi_default_method, nullptr},
      {"readFile", nullptr, readFile, nullptr, nullptr, nullptr, napi_default_method, nullptr},
      {"close", nullptr, closeLease, nullptr, nullptr, nullptr, napi_default_method, nullptr}
    };
    napiCheck(napi_define_properties(env, result, std::size(methods), methods));
    napiCheck(napi_type_tag_object(env, result, &kLeaseTag));
    auto wrapped = std::make_unique<WrappedLease>(WrappedLease{lease});
    napiCheck(napi_wrap(env, result, wrapped.get(), finalizeLease, nullptr, nullptr));
    wrapped.release();
    auto state = static_cast<Environment*>(call.data);
    if (!state) throw Failure("NATIVE_BINDING_ERROR", "The native environment is unavailable.");
    state->leases.erase(std::remove_if(state->leases.begin(), state->leases.end(),
                                      [](const auto& item) { return item.expired(); }), state->leases.end());
    state->leases.emplace_back(lease);
    return result;
    } catch (...) {
      // Even a binding/allocation failure after successful native creation must
      // close the lease and attempt rollback through the retained root handle.
      if (create) {
        try { cleanupCreated(lease->root()); }
        catch (...) { lease->close(); throw; }
      }
      lease->close();
      throw;
    }
  });
}
napi_value createDirectory(napi_env env, napi_callback_info info) { return directoryCall(env, info, true); }
napi_value openPrivateDirectory(napi_env env, napi_callback_info info) { return directoryCall(env, info, false); }
void cleanupEnvironment(void* data) {
  std::unique_ptr<Environment> state(static_cast<Environment*>(data));
  for (const auto& item : state->leases) if (auto lease = item.lock()) lease->close();
}
napi_value initialize(napi_env env, napi_value exports) {
  return protect(env, [&] {
    auto state = std::make_unique<Environment>();
    napiCheck(napi_add_env_cleanup_hook(env, cleanupEnvironment, state.get()));
    Environment* data = state.release();
    const napi_property_descriptor methods[] = {
      {"createPrivateDirectory", nullptr, createDirectory, nullptr, nullptr, nullptr, napi_default_method, data},
      {"openPrivateDirectory", nullptr, openPrivateDirectory, nullptr, nullptr, nullptr, napi_default_method, data}
    };
    napiCheck(napi_define_properties(env, exports, std::size(methods), methods));
    return exports;
  });
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
