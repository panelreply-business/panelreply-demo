"""Bounded read-only host observations for the fixed synthetic Safari fixture.

This is the Python runner's view. It cannot establish Safari sandbox access,
the original browser exception, or a native upload pass. No path is modified.
"""

import errno
import hashlib
import os
from pathlib import Path
import stat


MAX_BYTES = 2 * 1024 * 1024
MAX_ANCESTORS = 16
READ_CHUNK = 64 * 1024


def error_fields(error):
    number = getattr(error, "errno", None)
    return {"name": type(error).__name__[:100], "errno": number if type(number) is int else None,
            "code": errno.errorcode.get(number, "OTHER") if type(number) is int else "OTHER"}


def metadata(value):
    kind = "regular" if stat.S_ISREG(value.st_mode) else "directory" if stat.S_ISDIR(value.st_mode) \
        else "symlink" if stat.S_ISLNK(value.st_mode) else "other"
    return {"kind": kind, "mode": oct(stat.S_IMODE(value.st_mode)), "uid": value.st_uid, "gid": value.st_gid,
            "device": str(value.st_dev), "inode": str(value.st_ino), "links": value.st_nlink,
            "bytes": value.st_size, "modifiedNs": str(value.st_mtime_ns), "changedNs": str(value.st_ctime_ns),
            "flags": getattr(value, "st_flags", None)}


def observe_fixture(filename):
    """Inspect the supplied fixed harness fixture with no follow-up mutation.

    The caller supplies IMAGE, never a browser-selected or request-supplied path.
    Only owned temporary fixtures are passed by the portable harness.
    """
    filename = Path(filename)
    result = {"format": "panelreply-safari-host-fixture-v1", "status": "NOT_READ",
              "subject": "Python harness process, not Safari or its web process",
              "path": str(filename)[:2048], "byteLimit": MAX_BYTES, "readChunkLimit": READ_CHUNK,
              "ancestorLimit": MAX_ANCESTORS, "fileContentRecorded": False,
              "originalBrowserExceptionCaptured": False, "bytesRead": 0,
              "descriptorOpened": False, "descriptorClosed": False, "ancestors": [],
              "process": {"effectiveUid": os.geteuid() if hasattr(os, "geteuid") else None,
                          "effectiveGid": os.getegid() if hasattr(os, "getegid") else None}}
    parents = list(filename.parents)
    result["ancestorsTruncated"] = len(parents) > MAX_ANCESTORS
    for parent in parents[:MAX_ANCESTORS]:
        item = {"path": str(parent)[:2048]}
        try:
            item["metadata"] = metadata(parent.lstat())
        except Exception as error:
            item["error"] = error_fields(error)
        result["ancestors"].append(item)
    descriptor = None
    stage = "path-metadata"
    try:
        initial = filename.lstat()
        result["pathBefore"] = metadata(initial)
        if not stat.S_ISREG(initial.st_mode):
            result["reason"] = "NOT_A_REGULAR_FILE"
            return result
        if not 1 <= initial.st_size <= MAX_BYTES:
            result["reason"] = "FILE_SIZE_OUTSIDE_BOUND"
            return result
        stage = "open"
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        result["openFlags"] = {"readOnly": True, "noFollowSupported": bool(getattr(os, "O_NOFOLLOW", 0)),
                               "nonblockingSupported": bool(getattr(os, "O_NONBLOCK", 0))}
        descriptor = os.open(filename, flags)
        result["descriptorOpened"] = True
        stage = "descriptor-metadata-before"
        held = os.fstat(descriptor)
        result["descriptorBefore"] = metadata(held)
        if not stat.S_ISREG(held.st_mode) or result["descriptorBefore"] != result["pathBefore"]:
            result["status"] = "CHANGED"
            result["reason"] = "OPENED_IDENTITY_DIFFERS_FROM_PATH"
            return result
        stage = "read"
        digest = hashlib.sha256()
        while result["bytesRead"] <= MAX_BYTES:
            chunk = os.read(descriptor, min(READ_CHUNK, MAX_BYTES + 1 - result["bytesRead"]))
            if not chunk:
                break
            result["bytesRead"] += len(chunk)
            if result["bytesRead"] > MAX_BYTES:
                result["status"] = "CHANGED"
                result["reason"] = "READ_EXCEEDED_BYTE_BOUND"
                return result
            digest.update(chunk)
        stage = "descriptor-metadata-after"
        result["descriptorAfter"] = metadata(os.fstat(descriptor))
        stage = "path-metadata-after"
        result["pathAfter"] = metadata(filename.lstat())
        result["stableIdentityAndMetadata"] = result["pathBefore"] == result["descriptorBefore"] \
            == result["descriptorAfter"] == result["pathAfter"]
        result["matchesMetadataBytes"] = result["bytesRead"] == initial.st_size
        if not result["stableIdentityAndMetadata"] or not result["matchesMetadataBytes"]:
            result["status"] = "CHANGED"
            result["reason"] = "FILE_CHANGED_DURING_OBSERVATION"
            return result
        result["sha256"] = digest.hexdigest()
        result["status"] = "READ"
    except Exception as error:
        result["status"] = "ERROR"
        result["error"] = {"stage": stage, **error_fields(error)}
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
                result["descriptorClosed"] = True
            except Exception as error:
                result["closeError"] = error_fields(error)
                result["status"] = "ERROR"
    return result
