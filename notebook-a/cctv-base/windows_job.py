"""Windows job closes all owned children if the supervisor exits unexpectedly."""
import ctypes as c
from ctypes import wintypes as w

class Basic(c.Structure):
    _fields_=[('PerProcessUserTimeLimit',c.c_longlong),('PerJobUserTimeLimit',c.c_longlong),
              ('LimitFlags',w.DWORD),('MinimumWorkingSetSize',c.c_size_t),
              ('MaximumWorkingSetSize',c.c_size_t),('ActiveProcessLimit',w.DWORD),
              ('Affinity',c.c_size_t),('PriorityClass',w.DWORD),('SchedulingClass',w.DWORD)]
class IO(c.Structure):
    _fields_=[(name,c.c_ulonglong) for name in ('ReadOperationCount','WriteOperationCount',
        'OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount')]
class Extended(c.Structure):
    _fields_=[('BasicLimitInformation',Basic),('IoInfo',IO),('ProcessMemoryLimit',c.c_size_t),
              ('JobMemoryLimit',c.c_size_t),('PeakProcessMemoryUsed',c.c_size_t),('PeakJobMemoryUsed',c.c_size_t)]

class Job:
    def __init__(self):
        self.api=c.WinDLL('kernel32',use_last_error=True)
        self.api.CreateJobObjectW.argtypes=[c.c_void_p,w.LPCWSTR]
        self.api.CreateJobObjectW.restype=w.HANDLE
        self.api.SetInformationJobObject.argtypes=[w.HANDLE,c.c_int,c.c_void_p,w.DWORD]
        self.api.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]
        self.handle=self.api.CreateJobObjectW(None,None)
        if not self.handle:raise c.WinError(c.get_last_error())
        info=Extended();info.BasicLimitInformation.LimitFlags=0x2000
        if not self.api.SetInformationJobObject(self.handle,9,c.byref(info),c.sizeof(info)):
            raise c.WinError(c.get_last_error())
    def add(self,process):
        if not self.api.AssignProcessToJobObject(self.handle,w.HANDLE(int(process._handle))):
            process.kill();raise c.WinError(c.get_last_error())
