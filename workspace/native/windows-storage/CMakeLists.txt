cmake_minimum_required(VERSION 3.27)
project(panelreply_windows_storage LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "This component requires native Windows x64 and MSVC")
endif()
if(NOT EXISTS "${NODE_HEADERS}/node_api.h" OR NOT EXISTS "${NODE_IMPORT_LIBRARY}")
  message(FATAL_ERROR "Verified Node headers and the Windows import library are required")
endif()
if(NOT CMAKE_GENERATOR STREQUAL "Visual Studio 17 2022" OR
   NOT CMAKE_VS_PLATFORM_NAME STREQUAL "x64" OR
   NOT CMAKE_VS_PLATFORM_TOOLSET STREQUAL "v143" OR
   NOT CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION STREQUAL "10.0.26100.0")
  message(FATAL_ERROR "The observed generator, platform, toolset and SDK must match the component pins")
endif()
file(WRITE "${CMAKE_BINARY_DIR}/configured-toolchain.json"
  "{\n\"generator\":\"${CMAKE_GENERATOR}\",\n\"platform\":\"${CMAKE_VS_PLATFORM_NAME}\",\n\"toolset\":\"${CMAKE_VS_PLATFORM_TOOLSET}\",\n\"windowsSdk\":\"${CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION}\",\n\"compiler\":\"${CMAKE_CXX_COMPILER}\",\n\"compilerId\":\"${CMAKE_CXX_COMPILER_ID}\",\n\"compilerVersion\":\"${CMAKE_CXX_COMPILER_VERSION}\",\n\"cmakeVersion\":\"${CMAKE_VERSION}\"\n}\n")

function(storage_target name)
  add_library(${name} SHARED storage.cc)
  target_compile_features(${name} PRIVATE cxx_std_17)
  target_compile_definitions(${name} PRIVATE NAPI_VERSION=8 NODE_GYP_MODULE_NAME=${name} WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _WIN32_WINNT=0x0A00)
  target_compile_options(${name} PRIVATE /W4 /WX /EHsc /guard:cf /utf-8)
  target_include_directories(${name} PRIVATE "${NODE_HEADERS}")
  target_link_libraries(${name} PRIVATE "${NODE_IMPORT_LIBRARY}" advapi32)
  target_link_options(${name} PRIVATE /guard:cf /DYNAMICBASE /NXCOMPAT)
  set_target_properties(${name} PROPERTIES PREFIX "" SUFFIX ".node")
endfunction()

storage_target(panelreply_windows_storage)
# The operation source and compiler options are the same. This separate binary
# adds only gated observation points and uses a different native receiver tag.
storage_target(panelreply_windows_storage_probe)
target_compile_definitions(panelreply_windows_storage_probe PRIVATE PANELREPLY_STORAGE_TEST_PROBE=1)

# This adversarial fixture executable is not linked into the component and is
# never loaded by either product. It only operates on new disposable test paths.
add_executable(panelreply_windows_storage_fixture fixture.cc)
target_compile_features(panelreply_windows_storage_fixture PRIVATE cxx_std_17)
target_compile_definitions(panelreply_windows_storage_fixture PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _WIN32_WINNT=0x0A00)
target_compile_options(panelreply_windows_storage_fixture PRIVATE /W4 /WX /EHsc /guard:cf /utf-8)
target_link_libraries(panelreply_windows_storage_fixture PRIVATE advapi32)
target_link_options(panelreply_windows_storage_fixture PRIVATE /guard:cf /DYNAMICBASE /NXCOMPAT)
