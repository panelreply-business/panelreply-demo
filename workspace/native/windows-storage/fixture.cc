// Disposable adversarial fixtures only. This executable is not a product API.
#include <windows.h>
#include <winternl.h>
#include <winioctl.h>
#include <aclapi.h>
#include <sddl.h>

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
constexpr char kContents[] = "Synthetic private storage fixture. No customer data.\n";
struct Error : std::runtime_error {
  DWORD value;
  explicit Error(const char* message, DWORD code = GetLastError()) : std::runtime_error(message), value(code) {}
};
struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE handle = INVALID_HANDLE_VALUE) : value(handle) {}
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
  ~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
};
struct Local {
  void* value = nullptr;
  ~Local() { if (value) LocalFree(value); }
};
void require(bool condition, const char* message) { if (!condition) throw Error(message); }
std::string quote(const std::wstring& text) {
  const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  if (!text.empty()) require(count > 0, "Could not encode fixture metadata");
  std::string utf8(static_cast<size_t>(count), '\0');
  if (count) require(WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), utf8.data(), count, nullptr, nullptr) == count, "Could not encode fixture metadata");
  std::string result = "\"";
  const char hex[] = "0123456789abcdef";
  for (const unsigned char byte : utf8) {
    if (byte == '"' || byte == '\\') { result += '\\'; result += static_cast<char>(byte); }
    else if (byte < 32) { result += "\\u00"; result += hex[byte >> 4]; result += hex[byte & 15]; }
    else result += static_cast<char>(byte);
  }
  return result + '"';
}
std::wstring sidText(PSID sid) {
  LPWSTR text = nullptr;
  require(IsValidSid(sid) && ConvertSidToStringSidW(sid, &text), "Could not read fixture SID");
  Local memory; memory.value = text;
  return text;
}
std::wstring tokenSid(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
  DWORD required = 0;
  GetTokenInformation(token, kind, nullptr, 0, &required);
  require(required > 0 && required < 65536, "Could not size token metadata");
  std::vector<unsigned char> data(required);
  require(GetTokenInformation(token, kind, data.data(), required, &required), "Could not read token metadata");
  const PSID sid = kind == TokenUser ? reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid
                                    : reinterpret_cast<TOKEN_OWNER*>(data.data())->Owner;
  return sidText(sid);
}
std::wstring processUser() { return tokenSid(GetCurrentProcessToken(), TokenUser); }
template <typename T> T tokenValue(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
  T value{}; DWORD size = 0;
  require(GetTokenInformation(token, kind, &value, static_cast<DWORD>(sizeof(value)), &size),
      "Could not read process token observation");
  if (size != sizeof(value)) throw Error("Unexpected process token observation size", ERROR_INVALID_DATA);
  return value;
}
std::wstring filetimeText(const FILETIME& value) {
  return std::to_wstring((static_cast<unsigned long long>(value.dwHighDateTime) << 32) | value.dwLowDateTime);
}
std::wstring luidText(const LUID& value) {
  return std::to_wstring((static_cast<unsigned long long>(static_cast<DWORD>(value.HighPart)) << 32) | value.LowPart);
}
void processToken(const std::wstring& argument, const std::wstring& expectedCreation) {
  if (argument.empty() || argument.size() > 10) throw Error("A bounded owned process ID is required", ERROR_INVALID_PARAMETER);
  unsigned long long number = 0;
  for (const wchar_t digit : argument) {
    if (digit < L'0' || digit > L'9') throw Error("Invalid owned process ID", ERROR_INVALID_PARAMETER);
    number = number * 10 + static_cast<unsigned long long>(digit - L'0');
  }
  if (number == 0 || number > MAXDWORD || std::to_wstring(number) != argument)
    throw Error("Invalid owned process ID", ERROR_INVALID_PARAMETER);
  if (!expectedCreation.empty() && (expectedCreation.size() > 20 ||
      std::any_of(expectedCreation.begin(), expectedCreation.end(), [](wchar_t c) { return c < L'0' || c > L'9'; })))
    throw Error("Invalid expected process creation identity", ERROR_INVALID_PARAMETER);
  const DWORD pid = static_cast<DWORD>(number);
  // Query only. No debug privilege, token adjustment, impersonation, process
  // termination or permission change is performed by this observation helper.
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
  require(process.value != nullptr, "Could not query owned process");
  require(GetProcessId(process.value) == pid, "The process query returned another process ID");
  FILETIME created{}, exited{}, kernel{}, userTime{};
  require(GetProcessTimes(process.value, &created, &exited, &kernel, &userTime), "Could not observe process creation identity");
  const std::wstring creation = filetimeText(created);
  if (!expectedCreation.empty() && creation != expectedCreation)
    throw Error("The owned process creation identity changed", ERROR_INVALID_DATA);
  DWORD exitCode = 0;
  require(GetExitCodeProcess(process.value, &exitCode), "Could not observe owned process liveness");
  if (exitCode != STILL_ACTIVE) throw Error("The observed owned process has exited", ERROR_INVALID_STATE);
  wchar_t image[8192]{}; DWORD imageLength = static_cast<DWORD>(std::size(image));
  require(QueryFullProcessImageNameW(process.value, 0, image, &imageLength) && imageLength > 0,
      "Could not observe owned process image");
  HANDLE rawToken = nullptr;
  require(OpenProcessToken(process.value, TOKEN_QUERY, &rawToken), "Could not query owned process token");
  Handle token(rawToken);
  const auto statisticsBefore = tokenValue<TOKEN_STATISTICS>(token.value, TokenStatistics);
  const std::wstring sid = tokenSid(token.value, TokenUser);
  const std::wstring observerSid = processUser();
  if (sid != observerSid) throw Error("The observed process belongs to another user", ERROR_ACCESS_DENIED);
  const std::wstring owner = tokenSid(token.value, TokenOwner);
  const auto type = tokenValue<TOKEN_TYPE>(token.value, TokenType);
  if (type != TokenPrimary) throw Error("The observed process token is not primary", ERROR_INVALID_DATA);
  const auto elevation = tokenValue<TOKEN_ELEVATION>(token.value, TokenElevation);
  const auto elevationType = tokenValue<TOKEN_ELEVATION_TYPE>(token.value, TokenElevationType);
  const auto statistics = tokenValue<TOKEN_STATISTICS>(token.value, TokenStatistics);
  if (luidText(statistics.TokenId) != luidText(statisticsBefore.TokenId) ||
      luidText(statistics.ModifiedId) != luidText(statisticsBefore.ModifiedId))
    throw Error("The process token changed during its query", ERROR_INVALID_DATA);
  require(GetExitCodeProcess(process.value, &exitCode), "Could not recheck owned process liveness");
  if (exitCode != STILL_ACTIVE) throw Error("The observed owned process exited during its query", ERROR_INVALID_STATE);
  std::cout << "{\"pid\":" << pid << ",\"creationFiletime\":" << quote(creation)
            << ",\"imagePath\":" << quote(std::wstring(image, imageLength))
            << ",\"userSid\":" << quote(sid) << ",\"defaultOwnerSid\":" << quote(owner)
            << ",\"observerUserSid\":" << quote(observerSid)
            << ",\"tokenType\":\"primary\",\"elevated\":" << (elevation.TokenIsElevated ? "true" : "false")
            << ",\"elevationType\":" << static_cast<unsigned int>(elevationType)
            << ",\"tokenId\":" << quote(luidText(statistics.TokenId))
            << ",\"tokenModifiedId\":" << quote(luidText(statistics.ModifiedId))
            << ",\"authenticationId\":" << quote(luidText(statistics.AuthenticationId))
            << ",\"processAccess\":\"PROCESS_QUERY_LIMITED_INFORMATION\",\"tokenAccess\":\"TOKEN_QUERY\"}\n";
}
std::wstring canonical(const std::wstring& path) {
  const DWORD needed = GetFullPathNameW(path.c_str(), 0, nullptr, nullptr);
  require(needed > 0 && needed < 8192, "Fixture path must be bounded");
  std::vector<wchar_t> value(needed + 1);
  require(GetFullPathNameW(path.c_str(), static_cast<DWORD>(value.size()), value.data(), nullptr) > 0, "Could not normalize fixture path");
  return value.data();
}
void mutationPath(const std::wstring& path) {
  wchar_t root[8192]{};
  const DWORD length = GetEnvironmentVariableW(L"PANELREPLY_WINDOWS_TEST_ROOT", root, static_cast<DWORD>(std::size(root)));
  require(length > 0 && length < std::size(root), "The disposable fixture root is required");
  const std::wstring prefix = canonical(root) + L"\\";
  const std::wstring value = canonical(path);
  require(value.size() > prefix.size() && CompareStringOrdinal(value.data(), static_cast<int>(prefix.size()),
      prefix.data(), static_cast<int>(prefix.size()), TRUE) == CSTR_EQUAL, "Fixture mutation is outside its disposable root");
}
Handle openMetadata(const std::wstring& path) {
  // Owner READ_CONTROL does not imply SYNCHRONIZE. These handles perform
  // metadata queries only, so do not request synchronous file I/O.
  const DWORD flags = FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OVERLAPPED;
  HANDLE raw = CreateFileW(path.c_str(), READ_CONTROL | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      flags, nullptr);
  if (raw == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED) {
    raw = CreateFileW(path.c_str(), READ_CONTROL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, flags, nullptr);
  }
  require(raw != INVALID_HANDLE_VALUE, "Could not inspect fixture path");
  return Handle(raw);
}
std::wstring observedPath(HANDLE handle, DWORD flags) {
  const DWORD required = GetFinalPathNameByHandleW(handle, nullptr, 0, flags);
  if (required == 0 || required > 8192) return L"";
  std::vector<wchar_t> value(required + 1);
  const DWORD length = GetFinalPathNameByHandleW(handle, value.data(), static_cast<DWORD>(value.size()), flags);
  return length > 0 && length < value.size() ? std::wstring(value.data(), length) : L"";
}
std::string information(HANDLE handle) {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PSID owner = nullptr;
  PACL dacl = nullptr;
  const DWORD error = GetSecurityInfo(handle, SE_FILE_OBJECT,
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr, &dacl, nullptr, &descriptor);
  if (error != ERROR_SUCCESS) throw Error("Could not inspect fixture security", error);
  Local security; security.value = descriptor;
  LPWSTR sddl = nullptr;
  require(ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, SDDL_REVISION_1,
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &sddl, nullptr), "Could not serialize fixture security");
  Local text; text.value = sddl;
  SECURITY_DESCRIPTOR_CONTROL control = 0; DWORD revision = 0;
  require(GetSecurityDescriptorControl(descriptor, &control, &revision), "Could not inspect fixture control flags");
  BOOL present = FALSE, defaulted = FALSE;
  require(GetSecurityDescriptorDacl(descriptor, &present, &dacl, &defaulted), "Could not inspect fixture DACL state");
  BY_HANDLE_FILE_INFORMATION file{};
  const bool observedFile = GetFileInformationByHandle(handle, &file) != FALSE;
  FILE_ID_INFO identifier{};
  const bool observedIdentity = GetFileInformationByHandleEx(handle, FileIdInfo, &identifier, sizeof(identifier)) != FALSE;
  const wchar_t hex[] = L"0123456789abcdef";
  std::wstring fileId;
  if (observedIdentity) for (const unsigned char byte : identifier.FileId.Identifier) {
    fileId += hex[byte >> 4]; fileId += hex[byte & 15];
  }
  wchar_t filesystem[32]{};
  DWORD flags = 0;
  const bool observedVolume = GetVolumeInformationByHandleW(handle, nullptr, 0, nullptr, nullptr, &flags,
      filesystem, static_cast<DWORD>(std::size(filesystem))) != FALSE;
  const std::wstring guidPath = observedPath(handle, VOLUME_NAME_GUID);
  const size_t volumeEnd = guidPath.find(L"}\\");
  const UINT volumeType = volumeEnd == std::wstring::npos ? DRIVE_UNKNOWN :
      GetDriveTypeW(guidPath.substr(0, volumeEnd + 2).c_str());
  std::string result = "{\"ownerSid\":" + quote(sidText(owner)) + ",\"processUserSid\":" + quote(processUser()) +
      ",\"tokenOwnerSid\":" + quote(tokenSid(GetCurrentProcessToken(), TokenOwner)) +
      ",\"sddl\":" + quote(sddl) + ",\"protectedDacl\":" + ((control & SE_DACL_PROTECTED) ? "true" : "false") +
      ",\"daclPresent\":" + (present ? "true" : "false") + ",\"nullDacl\":" + (dacl ? "false" : "true") +
      ",\"aceCount\":" + (dacl ? std::to_string(dacl->AceCount) : "null") +
      ",\"filesystem\":" + (observedVolume ? quote(filesystem) : "null") +
      ",\"persistentAcls\":" + ((observedVolume && (flags & FILE_PERSISTENT_ACLS)) ? "true" : "false") +
      ",\"volumeType\":" + std::to_string(volumeType) +
      ",\"canonicalPath\":" + quote(observedPath(handle, VOLUME_NAME_DOS)) +
      ",\"volumeGuidPath\":" + quote(guidPath) +
      ",\"fileId\":" + (observedIdentity ? quote(fileId) : "null") +
      ",\"volumeSerial\":" + (observedIdentity ? quote(std::to_wstring(identifier.VolumeSerialNumber)) : "null") +
      ",\"fileAttributes\":" + (observedFile ? std::to_string(file.dwFileAttributes) : "null") +
      ",\"bytes\":" + (observedFile ? std::to_string((static_cast<unsigned long long>(file.nFileSizeHigh) << 32) | file.nFileSizeLow) : "null") +
      ",\"links\":" + (observedFile ? std::to_string(file.nNumberOfLinks) : "null") + "}";
  return result;
}
std::wstring differentOwner() {
  const std::wstring user = processUser();
  const std::wstring owner = tokenSid(GetCurrentProcessToken(), TokenOwner);
  if (owner != user) return owner;
  DWORD required = 0;
  GetTokenInformation(GetCurrentProcessToken(), TokenGroups, nullptr, 0, &required);
  require(required > 0 && required < 1024 * 1024, "Could not size token groups");
  std::vector<unsigned char> data(required);
  require(GetTokenInformation(GetCurrentProcessToken(), TokenGroups, data.data(), required, &required), "Could not inspect token groups");
  const auto groups = reinterpret_cast<TOKEN_GROUPS*>(data.data());
  for (DWORD index = 0; index < groups->GroupCount; ++index) {
    if ((groups->Groups[index].Attributes & (SE_GROUP_OWNER | SE_GROUP_ENABLED)) == (SE_GROUP_OWNER | SE_GROUP_ENABLED)) {
      const std::wstring candidate = sidText(groups->Groups[index].Sid);
      if (candidate != user) return candidate;
    }
  }
  return L"";
}
std::wstring fixtureSddl(const std::wstring& policy, bool directory) {
  const std::wstring user = processUser();
  const std::wstring inheritance = directory ? L"OICI" : L"";
  std::wstring owner = user;
  if (policy == L"wrong-owner") {
    owner = differentOwner();
    if (owner.empty()) return L"";
  }
  const std::wstring grant = L"(A;" + inheritance + L";FA;;;" + user + L")";
  if (policy == L"null") return L"O:" + owner + L"D:NO_ACCESS_CONTROL";
  if (policy == L"empty") return L"O:" + owner + L"D:P";
  if (policy == L"unprotected") return L"O:" + owner + L"D:" + grant;
  if (policy == L"broad") return L"O:" + owner + L"D:P" + grant + L"(A;" + inheritance + L";FR;;;WD)";
  if (policy == L"anonymous-control") return L"O:" + owner + L"D:P" + grant + L"(A;;FR;;;AN)";
  if (policy == L"anonymous-parent" && directory) return L"O:" + owner + L"D:P" + grant + L"(A;;0x1200a9;;;AN)";
  if (policy == L"private" || policy == L"wrong-owner") return L"O:" + owner + L"D:P" + grant;
  throw Error("Unknown fixture ACL policy", ERROR_INVALID_PARAMETER);
}
void createFixture(const std::wstring& path, const std::wstring& policy, bool directory) {
  mutationPath(path);
  const std::wstring sddl = fixtureSddl(policy, directory);
  if (sddl.empty()) { std::cout << "{\"created\":false,\"capability\":\"different-owner-unavailable\"}\n"; return; }
  PSECURITY_DESCRIPTOR raw = nullptr;
  require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &raw, nullptr), "Could not create fixture descriptor");
  Local descriptor; descriptor.value = raw;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), raw, FALSE};
  if (directory) {
    require(CreateDirectoryW(path.c_str(), &security), "Could not create exclusive directory fixture");
    Handle handle = openMetadata(path);
    const std::string metadata = information(handle.value);
    std::cout << "{\"created\":true,\"metadata\":" << metadata << "}\n";
  } else {
    Handle handle(CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, &security, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    require(handle.value != INVALID_HANDLE_VALUE, "Could not create exclusive file fixture");
    DWORD written = 0;
    require(WriteFile(handle.value, kContents, static_cast<DWORD>(sizeof(kContents) - 1), &written, nullptr) &&
        written == sizeof(kContents) - 1 && FlushFileBuffers(handle.value), "Could not persist fixture bytes");
    const std::string metadata = information(handle.value);
    std::cout << "{\"created\":true,\"metadata\":" << metadata << "}\n";
  }
}

using NtCreateFunction = NTSTATUS (NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES,
    PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using ConvertStatusFunction = ULONG (WINAPI *)(NTSTATUS);
template <typename T> T nativeFunction(const char* name) {
  FARPROC raw = GetProcAddress(GetModuleHandleW(L"ntdll.dll"), name);
  require(raw != nullptr, "Required documented native function is unavailable");
  static_assert(sizeof(T) == sizeof(raw));
  T result; std::memcpy(&result, &raw, sizeof(result)); return result;
}
Handle relativeOpen(HANDLE parent, const std::wstring& name, ACCESS_MASK access, DWORD& error) {
  UNICODE_STRING text{};
  require(name.size() < 8192, "Relative fixture name is too long");
  text.Buffer = const_cast<PWSTR>(name.data());
  text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length;
  OBJECT_ATTRIBUTES object{};
  object.Length = sizeof(object); object.RootDirectory = parent; object.ObjectName = &text; object.Attributes = 0x40;
  IO_STATUS_BLOCK io{};
  HANDLE raw = INVALID_HANDLE_VALUE;
  const NTSTATUS status = nativeFunction<NtCreateFunction>("NtCreateFile")(&raw, access | SYNCHRONIZE,
      &object, &io, nullptr, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      1, 0x20 | 0x00200000, nullptr, 0);
  error = status < 0 ? nativeFunction<ConvertStatusFunction>("RtlNtStatusToDosError")(status) : ERROR_SUCCESS;
  return Handle(raw);
}
std::pair<DWORD, std::string> readRelative(HANDLE parent, const std::wstring& name) {
  DWORD error = 0;
  Handle file = relativeOpen(parent, name, GENERIC_READ, error);
  if (error != ERROR_SUCCESS) return {error, ""};
  char bytes[1024]{}; DWORD read = 0;
  if (!ReadFile(file.value, bytes, sizeof(bytes), &read, nullptr)) return {GetLastError(), ""};
  return {ERROR_SUCCESS, std::string(bytes, read)};
}
struct Anonymous {
  bool active = false;
  Anonymous() {
    Handle thread(OpenThread(THREAD_IMPERSONATE | THREAD_QUERY_INFORMATION, FALSE, GetCurrentThreadId()));
    require(thread.value != nullptr && thread.value != INVALID_HANDLE_VALUE, "Could not open fixture thread for anonymous impersonation");
    require(ImpersonateAnonymousToken(thread.value), "Anonymous impersonation is unavailable");
    active = true;
  }
  void restore() {
    if (active && !RevertToSelf()) {
      TerminateProcess(GetCurrentProcess(), 97);
      ExitProcess(97);
    }
    active = false;
  }
  ~Anonymous() { restore(); }
};
void anonymousRead(const std::wstring& path, const std::wstring& privateName, const std::wstring& publicName) {
  mutationPath(path + L"\\anonymous-probe");
  require(privateName.find_first_of(L"\\/:") == std::wstring::npos && publicName.find_first_of(L"\\/:") == std::wstring::npos,
          "Anonymous fixture children must be single names");
  HANDLE existing = nullptr;
  if (OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &existing)) {
    Handle handle(existing);
    throw Error("Fixture thread already has an impersonation token", ERROR_BAD_IMPERSONATION_LEVEL);
  }
  require(GetLastError() == ERROR_NO_TOKEN, "Could not verify the original thread identity");
  const std::wstring before = tokenSid(GetCurrentThreadEffectiveToken(), TokenUser);
  DWORD error = 0;
  Handle parent = relativeOpen(nullptr, L"\\??\\" + canonical(path), READ_CONTROL | FILE_TRAVERSE, error);
  if (error != ERROR_SUCCESS) throw Error("Could not open the anonymous experiment parent", error);
  std::wstring alternate;
  std::pair<DWORD, std::string> control, denied;
  {
    Anonymous token;
    alternate = tokenSid(GetCurrentThreadEffectiveToken(), TokenUser);
    control = readRelative(parent.value, publicName);
    denied = readRelative(parent.value, privateName);
    token.restore();
  }
  const std::wstring after = tokenSid(GetCurrentThreadEffectiveToken(), TokenUser);
  const auto restored = readRelative(parent.value, privateName);
  const bool controlRead = control.first == ERROR_SUCCESS && control.second == kContents;
  const bool ownerRead = restored.first == ERROR_SUCCESS && restored.second == kContents;
  std::cout << "{\"beforeSid\":" << quote(before) << ",\"alternateSid\":" << quote(alternate)
            << ",\"afterSid\":" << quote(after) << ",\"controlError\":" << control.first
            << ",\"controlRead\":" << (controlRead ? "true" : "false")
            << ",\"privateError\":" << denied.first << ",\"privateRead\":" << (denied.first == ERROR_SUCCESS ? "true" : "false")
            << ",\"restoredOwnerRead\":" << (ownerRead ? "true" : "false") << "}\n";
}

struct MountPoint {
  ULONG tag;
  USHORT dataLength;
  USHORT reserved;
  USHORT substituteOffset;
  USHORT substituteLength;
  USHORT printOffset;
  USHORT printLength;
  wchar_t names[1];
};
static_assert(offsetof(MountPoint, names) == 16);
void setJunction(const std::wstring& path, const std::wstring& target, bool attributesOnly) {
  mutationPath(path); mutationPath(target + L"\\junction-target-check");
  const std::wstring printed = canonical(target), substitute = L"\\??\\" + printed;
  const size_t bytes = (substitute.size() + printed.size() + 2) * sizeof(wchar_t);
  require(bytes + 8 < 16384, "Junction fixture exceeds the reparse data bound");
  std::vector<unsigned char> buffer(16 + bytes);
  auto data = reinterpret_cast<MountPoint*>(buffer.data());
  data->tag = IO_REPARSE_TAG_MOUNT_POINT;
  data->dataLength = static_cast<USHORT>(8 + bytes);
  data->substituteLength = static_cast<USHORT>(substitute.size() * sizeof(wchar_t));
  data->printOffset = static_cast<USHORT>((substitute.size() + 1) * sizeof(wchar_t));
  data->printLength = static_cast<USHORT>(printed.size() * sizeof(wchar_t));
  std::memcpy(data->names, substitute.c_str(), (substitute.size() + 1) * sizeof(wchar_t));
  std::memcpy(reinterpret_cast<unsigned char*>(data->names) + data->printOffset, printed.c_str(), (printed.size() + 1) * sizeof(wchar_t));
  Handle directory(CreateFileW(path.c_str(), attributesOnly ? FILE_WRITE_ATTRIBUTES : GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (directory.value == INVALID_HANDLE_VALUE) {
    std::cout << "{\"opened\":false,\"mutated\":false,\"stage\":\"open\",\"win32Code\":" << GetLastError() << "}\n";
    return;
  }
  DWORD returned = 0;
  const bool changed = DeviceIoControl(directory.value, FSCTL_SET_REPARSE_POINT, buffer.data(),
      static_cast<DWORD>(buffer.size()), nullptr, 0, &returned, nullptr) != FALSE;
  const DWORD code = changed ? ERROR_SUCCESS : GetLastError();
  std::cout << "{\"opened\":true,\"mutated\":" << (changed ? "true" : "false")
            << ",\"stage\":\"fsctl\",\"win32Code\":" << code
            << ",\"requestedAccess\":\"" << (attributesOnly ? "FILE_WRITE_ATTRIBUTES" : "GENERIC_WRITE") << "\"}\n";
}
void holdWriter(const std::wstring& path) {
  mutationPath(path);
  Handle file(CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  require(file.value != INVALID_HANDLE_VALUE, "Could not open writer fixture");
  std::cout << "{\"ready\":true}\n" << std::flush;
  std::string input;
  std::getline(std::cin, input);
}

void renameFixture(const std::wstring& source, const std::wstring& destination) {
  mutationPath(source); mutationPath(destination);
  const bool renamed = MoveFileExW(source.c_str(), destination.c_str(), 0) != FALSE;
  const DWORD error = renamed ? ERROR_SUCCESS : GetLastError();
  std::cout << "{\"renamed\":" << (renamed ? "true" : "false") << ",\"win32Code\":" << error << "}\n";
}

std::wstring pipePath(const std::wstring& name) {
  require(name.rfind(L"panelreply-storage-", 0) == 0 && name.size() <= 80 &&
      name.find_first_not_of(L"abcdefghijklmnopqrstuvwxyz0123456789-") == std::wstring::npos,
      "Only a generated local fixture pipe name is permitted");
  return L"\\\\.\\pipe\\" + name;
}
std::string childObservation(HANDLE parent, const std::wstring& name) {
  DWORD error = 0;
  Handle child = relativeOpen(parent, name, READ_CONTROL | FILE_READ_ATTRIBUTES, error);
  if (error != ERROR_SUCCESS) return "{\"exists\":false,\"win32Code\":" + std::to_string(error) + "}";
  return "{\"exists\":true,\"win32Code\":0,\"metadata\":" + information(child.value) + "}";
}
std::string directoryObservation(HANDLE parent, const std::wstring& name) {
  // Enumerate through the independently retained directory handle too. A
  // relative child open can itself refuse a root that became a reparse point.
  // Such an access error is never reinterpreted as proof of child absence.
  bool found = false;
  unsigned long entries = 0;
  std::vector<unsigned char> bytes(65536);
  for (int page = 0; page < 4; ++page) {
    const FILE_INFO_BY_HANDLE_CLASS kind = page == 0 ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo;
    if (!GetFileInformationByHandleEx(parent, kind, bytes.data(), static_cast<DWORD>(bytes.size()))) {
      const DWORD error = GetLastError();
      if (error == ERROR_NO_MORE_FILES) return "{\"complete\":true,\"present\":" + std::string(found ? "true" : "false") +
          ",\"entries\":" + std::to_string(entries) + "}";
      throw Error("The independent held-directory enumeration failed", error);
    }
    size_t offset = 0;
    for (;;) {
      require(offset + offsetof(FILE_ID_BOTH_DIR_INFO, FileName) <= bytes.size(), "Directory observation contains a truncated entry");
      const auto item = reinterpret_cast<FILE_ID_BOTH_DIR_INFO*>(bytes.data() + offset);
      require(item->FileNameLength % sizeof(wchar_t) == 0 &&
          item->FileNameLength <= bytes.size() - offset - offsetof(FILE_ID_BOTH_DIR_INFO, FileName),
          "Directory observation contains an invalid name");
      const std::wstring observed(item->FileName, item->FileNameLength / sizeof(wchar_t));
      if (CompareStringOrdinal(observed.data(), static_cast<int>(observed.size()), name.data(),
          static_cast<int>(name.size()), TRUE) == CSTR_EQUAL) found = true;
      ++entries;
      if (item->NextEntryOffset == 0) break;
      require(item->NextEntryOffset >= offsetof(FILE_ID_BOTH_DIR_INFO, FileName) &&
          item->NextEntryOffset <= bytes.size() - offset, "Directory observation contains an invalid offset");
      offset += item->NextEntryOffset;
    }
  }
  throw Error("The disposable directory observation exceeded its bound", ERROR_MORE_DATA);
}
void observerServer(const std::wstring& source, const std::wstring& target,
                    const std::wstring& child, const std::wstring& name) {
  mutationPath(source + L"\\observer-check"); mutationPath(target + L"\\observer-check");
  require(!child.empty() && child != L"." && child != L".." && child.find_first_of(L"\\/:") == std::wstring::npos,
      "The observer child must be one fixture name");
  DWORD error = 0;
  Handle sourceHandle = relativeOpen(nullptr, L"\\??\\" + canonical(source), READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY, error);
  if (error) throw Error("Could not retain the independent source observer handle", error);
  Handle targetHandle = relativeOpen(nullptr, L"\\??\\" + canonical(target), READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY, error);
  if (error) throw Error("Could not retain the independent redirect observer handle", error);
  BY_HANDLE_FILE_INFORMATION sourceInfo{}, targetInfo{};
  require(GetFileInformationByHandle(sourceHandle.value, &sourceInfo) && GetFileInformationByHandle(targetHandle.value, &targetInfo) &&
      (sourceInfo.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(sourceInfo.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
      (targetInfo.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(targetInfo.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT),
      "Observer handles must initially identify two ordinary directories");
  const std::wstring sddl = fixtureSddl(L"private", false);
  PSECURITY_DESCRIPTOR raw = nullptr;
  require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &raw, nullptr), "Could not secure the fixture pipe");
  Local descriptor; descriptor.value = raw;
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), raw, FALSE};
  const std::wstring address = pipePath(name);
  Handle pipe(CreateNamedPipeW(address.c_str(), PIPE_ACCESS_OUTBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
      PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
      1, 65536, 0, 2000, &security));
  require(pipe.value != INVALID_HANDLE_VALUE, "Could not create the private observer pipe");
  std::cout << "{\"ready\":true,\"source\":" << information(sourceHandle.value)
            << ",\"target\":" << information(targetHandle.value) << "}\n" << std::flush;
  // This process never creates, writes, deletes or changes filesystem objects.
  // Its only writes are bounded observation messages to the private local pipe.
  for (int index = 0; index < 8; ++index) {
    if (!ConnectNamedPipe(pipe.value, nullptr) && GetLastError() != ERROR_PIPE_CONNECTED)
      throw Error("Could not connect the read-only observer client");
    const std::string result = "{\"source\":" + information(sourceHandle.value) +
        ",\"target\":" + information(targetHandle.value) +
        ",\"sourceDirectory\":" + directoryObservation(sourceHandle.value, child) +
        ",\"targetDirectory\":" + directoryObservation(targetHandle.value, child) +
        ",\"sourceChild\":" + childObservation(sourceHandle.value, child) +
        ",\"targetChild\":" + childObservation(targetHandle.value, child) + "}";
    require(result.size() <= 65536, "Observer snapshot exceeds its bound");
    DWORD written = 0;
    require(WriteFile(pipe.value, result.data(), static_cast<DWORD>(result.size()), &written, nullptr) &&
        written == result.size(), "Could not publish the observer snapshot");
    require(FlushFileBuffers(pipe.value), "The observer client did not read its snapshot");
    require(DisconnectNamedPipe(pipe.value), "Could not close the observer connection");
  }
}
void observerClient(const std::wstring& name) {
  const std::wstring address = pipePath(name);
  require(WaitNamedPipeW(address.c_str(), 2000), "The read-only observer did not become available");
  Handle pipe(CreateFileW(address.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING,
      SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
  require(pipe.value != INVALID_HANDLE_VALUE, "Could not connect to the read-only observer");
  char data[65536]{}; DWORD count = 0;
  require(ReadFile(pipe.value, data, sizeof(data), &count, nullptr) && count > 0,
      "Could not read a complete observer snapshot");
  std::cout.write(data, count); std::cout << '\n';
}

void removeEmptyFixture(const std::wstring& path, const std::wstring& volume,
    const std::wstring& expectedId, const std::wstring& kind) {
  mutationPath(path);
  if (volume.empty() || volume.size() > 20 ||
      std::any_of(volume.begin(), volume.end(), [](wchar_t c) { return c < L'0' || c > L'9'; }) ||
      expectedId.size() != 32 || std::any_of(expectedId.begin(), expectedId.end(), [](wchar_t c) {
        return !(c >= L'0' && c <= L'9') && !(c >= L'a' && c <= L'f');
      }) || (kind != L"file" && kind != L"directory"))
    throw Error("A recorded disposable fixture identity and type are required", ERROR_INVALID_PARAMETER);
  // No handle with DELETE access survives a product rejection check. Cleanup
  // opens a fresh handle afterward, with only query rights plus DELETE. The
  // parent may authorize deletion through FILE_DELETE_CHILD. Never repair an
  // ACL, clear attributes or enable a privilege to make cleanup succeed.
  Handle handle(CreateFileW(path.c_str(), READ_CONTROL | FILE_READ_ATTRIBUTES | DELETE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OVERLAPPED, nullptr));
  require(handle.value != INVALID_HANDLE_VALUE, "Could not open disposable empty-DACL fixture for cleanup");
  FILE_ID_INFO identity{};
  require(GetFileInformationByHandleEx(handle.value, FileIdInfo, &identity, sizeof(identity)),
      "Could not verify disposable fixture identity");
  std::wstring actualId;
  const wchar_t hex[] = L"0123456789abcdef";
  for (const unsigned char byte : identity.FileId.Identifier) {
    actualId += hex[byte >> 4]; actualId += hex[byte & 15];
  }
  if (actualId != expectedId || std::to_wstring(identity.VolumeSerialNumber) != volume)
    throw Error("The disposable fixture identity changed before cleanup", ERROR_INVALID_DATA);
  const std::wstring expectedPath = L"\\\\?\\" + canonical(path);
  const std::wstring actualPath = observedPath(handle.value, VOLUME_NAME_DOS);
  if (actualPath.empty() || CompareStringOrdinal(expectedPath.c_str(), -1, actualPath.c_str(), -1, TRUE) != CSTR_EQUAL)
    throw Error("The disposable fixture path changed before cleanup", ERROR_INVALID_DATA);
  BY_HANDLE_FILE_INFORMATION file{};
  require(GetFileInformationByHandle(handle.value, &file), "Could not verify disposable fixture type");
  if ((file.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_READONLY)) != 0 ||
      ((file.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != (kind == L"directory") ||
      (kind == L"file" && file.nNumberOfLinks != 1))
    throw Error("The disposable fixture is not an ordinary single object", ERROR_INVALID_DATA);
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PSID owner = nullptr; PACL dacl = nullptr;
  const DWORD error = GetSecurityInfo(handle.value, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &owner, nullptr, &dacl, nullptr, &descriptor);
  if (error != ERROR_SUCCESS) throw Error("Could not verify disposable fixture security", error);
  Local security; security.value = descriptor;
  SECURITY_DESCRIPTOR_CONTROL control = 0; DWORD revision = 0;
  BOOL present = FALSE, defaulted = FALSE;
  require(GetSecurityDescriptorControl(descriptor, &control, &revision) &&
      GetSecurityDescriptorDacl(descriptor, &present, &dacl, &defaulted), "Could not verify disposable fixture DACL");
  if (sidText(owner) != processUser() || !(control & SE_DACL_PROTECTED) || !present || !dacl || dacl->AceCount != 0)
    throw Error("Cleanup accepts only the owned protected empty-DACL fixture", ERROR_ACCESS_DENIED);
  const std::string metadata = information(handle.value);
  FILE_DISPOSITION_INFO disposition{TRUE};
  require(SetFileInformationByHandle(handle.value, FileDispositionInfo, &disposition, sizeof(disposition)),
      "Could not mark disposable empty-DACL fixture for deletion");
  // Deletion completes after this handle closes. The parent independently
  // verifies absence through its accessible directory listing after exit.
  std::cout << "{\"deleteDispositionSet\":true,\"metadata\":" << metadata << "}\n";
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  try {
    if (argc == 3 && std::wstring(argv[1]) == L"info") {
      Handle handle = openMetadata(argv[2]); std::cout << information(handle.value) << '\n';
    } else if ((argc == 3 || argc == 4) && std::wstring(argv[1]) == L"process-token") {
      processToken(argv[2], argc == 4 ? argv[3] : L"");
    } else if (argc == 4 && (std::wstring(argv[1]) == L"create-file" || std::wstring(argv[1]) == L"create-dir")) {
      createFixture(argv[2], argv[3], std::wstring(argv[1]) == L"create-dir");
    } else if (argc == 5 && std::wstring(argv[1]) == L"junction") {
      require(std::wstring(argv[4]) == L"attributes" || std::wstring(argv[4]) == L"write", "Invalid junction access mode");
      setJunction(argv[2], argv[3], std::wstring(argv[4]) == L"attributes");
    } else if (argc == 5 && std::wstring(argv[1]) == L"anonymous-read") {
      anonymousRead(argv[2], argv[3], argv[4]);
    } else if (argc == 3 && std::wstring(argv[1]) == L"hold-writer") {
      holdWriter(argv[2]);
    } else if (argc == 4 && std::wstring(argv[1]) == L"rename") {
      renameFixture(argv[2], argv[3]);
    } else if (argc == 6 && std::wstring(argv[1]) == L"observe-server") {
      observerServer(argv[2], argv[3], argv[4], argv[5]);
    } else if (argc == 3 && std::wstring(argv[1]) == L"observe-client") {
      observerClient(argv[2]);
    } else if (argc == 6 && std::wstring(argv[1]) == L"remove-empty") {
      removeEmptyFixture(argv[2], argv[3], argv[4], argv[5]);
    } else {
      throw Error("Unknown or malformed disposable fixture operation", ERROR_INVALID_PARAMETER);
    }
    return 0;
  } catch (const Error& error) {
    const std::string text(error.what());
    const std::wstring wide(text.begin(), text.end());
    std::cout << "{\"error\":" << quote(wide) << ",\"win32Code\":" << error.value << "}\n";
    return 2;
  } catch (const std::exception&) {
    std::cout << "{\"error\":\"Unexpected fixture failure\"}\n";
    return 3;
  }
}
