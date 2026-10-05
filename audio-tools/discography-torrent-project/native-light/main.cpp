#include "dea_native.hpp"

using namespace dea;

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,LPWSTR cmdLine,int){
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    std::wstring cmd=cmdLine?cmdLine:L"";

    if(cmd.find(L"--self-test")!=std::wstring::npos){
        std::wstring report;
        bool ok=Engine::SelfTest(report);
        if(FAILED(hr)==false)CoUninitialize();
        return ok?0:2;
    }
    if(cmd.find(L"--version")!=std::wstring::npos){
        if(FAILED(hr)==false)CoUninitialize();
        return 0;
    }

    MainWindow app(instance);
    int rc=app.Run();
    if(SUCCEEDED(hr))CoUninitialize();
    return rc;
}
