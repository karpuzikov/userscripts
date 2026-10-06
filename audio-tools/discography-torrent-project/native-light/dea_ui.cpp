#include "dea_native.hpp"
#include <uxtheme.h>
#include <windowsx.h>
#include <cstring>
#include <cwctype>

#pragma comment(lib, "uxtheme.lib")

namespace dea {
namespace {

enum : int {
    IDC_OPEN_EXISTING=1001, IDC_EXISTING=1002, IDC_BROWSE_EXISTING=1003, IDC_CLEAR_EXISTING=1004,
    IDC_OPEN_INCOMING=1005, IDC_INCOMING=1006, IDC_BROWSE_INCOMING=1007,
    IDC_SAVE_REMIXES=1010, IDC_SAVE_LIVE=1011, IDC_LOGGING=1012, IDC_PERSONAL=1013, IDC_OPEN_LOGS=1014,
    IDC_STATUS=1020, IDC_PROGRESS=1021, IDC_DETAIL=1022, IDC_ACTIVITY=1023,
    IDC_ANALYZE=1030, IDC_UNDO=1031, IDC_MAP=1032, IDC_CLOSE=1033,

    IDC_CHECKLIST=2001, IDC_CHECK_ALL=2002, IDC_UNCHECK_ALL=2003, IDC_CONTINUE=2004, IDC_CANCEL=2005,
    IDC_PICK_LIST=2101, IDC_PICK_EDIT=2102, IDC_PICK_PHRASE=2103, IDC_PICK_EXACT=2104, IDC_PICK_REMOVE=2105, IDC_PICK_SAVE=2106,

    IDC_MAP_SEARCH=3001, IDC_MAP_RELEASES=3002, IDC_MAP_OPEN_PATH=3003, IDC_MAP_PATH=3004, IDC_MAP_COPY=3005,
    IDC_MAP_IGNORE_RELEASE=3006, IDC_MAP_TRACKS=3007, IDC_MAP_IGNORE_TRACK=3008, IDC_MAP_REANALYZE=3009,
    IDC_MAP_APPLY=3010, IDC_MAP_CLOSE=3011, IDC_MAP_INITIAL=3012, IDC_MAP_RESULT=3013, IDC_MAP_INFO=3014
};

constexpr UINT WM_DEA_PROGRESS = WM_APP+10;
constexpr UINT WM_DEA_LOG = WM_APP+11;
constexpr UINT WM_DEA_PATTERN_REVIEW = WM_APP+12;
constexpr UINT WM_DEA_FINISHED = WM_APP+13;

COLORREF C_BG = RGB(11,12,15);
COLORREF C_PANEL = RGB(17,20,26);
COLORREF C_FIELD = RGB(22,26,32);
COLORREF C_TEXT = RGB(236,241,247);
COLORREF C_MUTED = RGB(151,163,179);
COLORREF C_LINE = RGB(42,48,58);
COLORREF C_BLUE = RGB(102,169,255);

int Scale(HWND h,int px){UINT dpi=GetDpiForWindow(h);return MulDiv(px,(int)dpi,96);}

void DarkTitle(HWND h){
    BOOL on=TRUE;
    constexpr DWORD DWMWA_USE_IMMERSIVE_DARK_MODE=20;
    DwmSetWindowAttribute(h,DWMWA_USE_IMMERSIVE_DARK_MODE,&on,sizeof(on));
}

HWND MakeCtrl(HWND parent,const wchar_t* cls,const wchar_t* text,DWORD style,int id){
    return CreateWindowExW(0,cls,text,style|WS_CHILD|WS_VISIBLE,0,0,10,10,parent,(HMENU)(INT_PTR)id,GetModuleHandleW(nullptr),nullptr);
}

void ThemeCtrl(HWND h){
    SetWindowTheme(h,L"DarkMode_Explorer",nullptr);
}

void SetFontAll(HWND parent,HFONT font){
    for(HWND c=GetWindow(parent,GW_CHILD);c;c=GetWindow(c,GW_HWNDNEXT))SendMessageW(c,WM_SETFONT,(WPARAM)font,TRUE);
}

std::wstring GetText(HWND h){
    int n=GetWindowTextLengthW(h);std::wstring s(n,0);if(n)GetWindowTextW(h,s.data(),n+1);return s;
}
std::wstring TrimUi(std::wstring s){
    while(!s.empty()&&std::iswspace(s.front()))s.erase(s.begin());
    while(!s.empty()&&std::iswspace(s.back()))s.pop_back();
    return s;
}
void PutText(HWND h,const std::wstring& s){SetWindowTextW(h,s.c_str());}

std::optional<fs::path> PickFolder(HWND owner,const fs::path& start){
    IFileDialog* dlg=nullptr;
    if(FAILED(CoCreateInstance(CLSID_FileOpenDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dlg))))return std::nullopt;
    DWORD o=0;dlg->GetOptions(&o);dlg->SetOptions(o|FOS_PICKFOLDERS|FOS_FORCEFILESYSTEM);
    if(!start.empty()&&fs::exists(start)){
        IShellItem* item=nullptr;if(SUCCEEDED(SHCreateItemFromParsingName(start.c_str(),nullptr,IID_PPV_ARGS(&item)))){dlg->SetFolder(item);item->Release();}
    }
    std::optional<fs::path> out;
    if(SUCCEEDED(dlg->Show(owner))){
        IShellItem* item=nullptr;if(SUCCEEDED(dlg->GetResult(&item))){
            PWSTR raw=nullptr;if(SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&raw))){out=fs::path(raw);CoTaskMemFree(raw);}item->Release();
        }
    }
    dlg->Release();return out;
}

struct ChecklistData {
    HWND owner{};
    std::wstring title;
    std::wstring subtitle;
    std::vector<std::pair<std::wstring,int>> items;
    std::set<std::wstring> prechecked;
    std::set<std::wstring> result;
    bool done=false;
    bool accepted=false;
    HWND list{};
};

LRESULT CALLBACK ChecklistProc(HWND h,UINT m,WPARAM w,LPARAM l){
    auto* d=(ChecklistData*)GetWindowLongPtrW(h,GWLP_USERDATA);
    if(m==WM_NCCREATE){d=(ChecklistData*)((CREATESTRUCTW*)l)->lpCreateParams;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)d);DarkTitle(h);}
    if(!d)return DefWindowProcW(h,m,w,l);
    switch(m){
    case WM_CREATE:{
        auto head=MakeCtrl(h,L"STATIC",d->title.c_str(),SS_LEFT,0);
        auto sub=MakeCtrl(h,L"STATIC",d->subtitle.c_str(),SS_LEFT,0);
        d->list=MakeCtrl(h,WC_LISTVIEWW,L"",LVS_REPORT|LVS_SINGLESEL|WS_TABSTOP,IDC_CHECKLIST);
        ListView_SetExtendedListViewStyle(d->list,LVS_EX_FULLROWSELECT|LVS_EX_CHECKBOXES|LVS_EX_DOUBLEBUFFER);
        LVCOLUMNW col{LVCF_TEXT|LVCF_WIDTH};col.pszText=(LPWSTR)L"Unusual pattern";col.cx=500;ListView_InsertColumn(d->list,0,&col);
        col.pszText=(LPWSTR)L"Count";col.cx=90;ListView_InsertColumn(d->list,1,&col);
        for(int i=0;i<(int)d->items.size();++i){LVITEMW it{LVIF_TEXT};it.iItem=i;it.pszText=(LPWSTR)d->items[i].first.c_str();ListView_InsertItem(d->list,&it);
            ListView_SetItemText(d->list,i,1,(LPWSTR)std::to_wstring(d->items[i].second).c_str());if(d->prechecked.count(d->items[i].first))ListView_SetCheckState(d->list,i,TRUE);}
        MakeCtrl(h,L"BUTTON",L"Check all",BS_PUSHBUTTON|WS_TABSTOP,IDC_CHECK_ALL);
        MakeCtrl(h,L"BUTTON",L"Uncheck all",BS_PUSHBUTTON|WS_TABSTOP,IDC_UNCHECK_ALL);
        MakeCtrl(h,L"BUTTON",L"Cancel",BS_PUSHBUTTON|WS_TABSTOP,IDC_CANCEL);
        MakeCtrl(h,L"BUTTON",L"Continue",BS_DEFPUSHBUTTON|WS_TABSTOP,IDC_CONTINUE);
        for(HWND c=GetWindow(h,GW_CHILD);c;c=GetWindow(c,GW_HWNDNEXT))ThemeCtrl(c);
        HFONT f=(HFONT)GetStockObject(DEFAULT_GUI_FONT);SetFontAll(h,f);
        SetWindowLongPtrW(head,GWLP_ID,2200);SetWindowLongPtrW(sub,GWLP_ID,2201);
        return 0;}
    case WM_SIZE:{
        int W=LOWORD(l),H=HIWORD(l),p=16;
        MoveWindow(GetDlgItem(h,2200),p,p,W-2*p,28,TRUE);
        MoveWindow(GetDlgItem(h,2201),p,48,W-2*p,38,TRUE);
        MoveWindow(d->list,p,92,W-2*p,H-150,TRUE);
        MoveWindow(GetDlgItem(h,IDC_CHECK_ALL),p,H-48,92,32,TRUE);
        MoveWindow(GetDlgItem(h,IDC_UNCHECK_ALL),p+100,H-48,102,32,TRUE);
        MoveWindow(GetDlgItem(h,IDC_CANCEL),W-198,H-48,84,32,TRUE);
        MoveWindow(GetDlgItem(h,IDC_CONTINUE),W-106,H-48,90,32,TRUE);
        return 0;}
    case WM_COMMAND:
        switch(LOWORD(w)){
        case IDC_CHECK_ALL:for(int i=0;i<ListView_GetItemCount(d->list);++i)ListView_SetCheckState(d->list,i,TRUE);break;
        case IDC_UNCHECK_ALL:for(int i=0;i<ListView_GetItemCount(d->list);++i)ListView_SetCheckState(d->list,i,FALSE);break;
        case IDC_CANCEL:d->accepted=false;d->done=true;DestroyWindow(h);break;
        case IDC_CONTINUE:
            d->result.clear();for(int i=0;i<(int)d->items.size();++i)if(ListView_GetCheckState(d->list,i))d->result.insert(d->items[i].first);
            d->accepted=true;d->done=true;DestroyWindow(h);break;
        }return 0;
    case WM_CLOSE:d->accepted=false;d->done=true;DestroyWindow(h);return 0;
    case WM_CTLCOLORSTATIC:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_PANEL);return (LRESULT)GetStockObject(NULL_BRUSH);}
    case WM_ERASEBKGND:{RECT r;GetClientRect(h,&r);HBRUSH b=CreateSolidBrush(C_PANEL);FillRect((HDC)w,&r,b);DeleteObject(b);return 1;}
    }
    return DefWindowProcW(h,m,w,l);
}

std::set<std::wstring> RunChecklist(HWND owner,const std::vector<std::pair<std::wstring,int>>& items,const std::set<std::wstring>& pre,bool& accepted){
    static bool registered=false;
    if(!registered){WNDCLASSW wc{};wc.lpfnWndProc=ChecklistProc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"DEA_Checklist";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClassW(&wc);registered=true;}
    ChecklistData d;d.owner=owner;d.title=L"Unusual track pattern review";
    d.subtitle=L"Only genuinely unknown version-like patterns appear here. Check a pattern to keep it now and save it as a Personal Pick.";
    d.items=items;d.prechecked=pre;
    EnableWindow(owner,FALSE);
    HWND h=CreateWindowExW(WS_EX_DLGMODALFRAME,L"DEA_Checklist",d.title.c_str(),WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_THICKFRAME,
                           CW_USEDEFAULT,CW_USEDEFAULT,760,600,owner,nullptr,GetModuleHandleW(nullptr),&d);
    ShowWindow(h,SW_SHOW);UpdateWindow(h);
    MSG msg;while(!d.done&&GetMessageW(&msg,nullptr,0,0)>0){if(!IsDialogMessageW(h,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}}
    EnableWindow(owner,TRUE);SetForegroundWindow(owner);accepted=d.accepted;return d.result;
}

struct PickDialogData{
    HWND owner{},list{},edit{};std::vector<PersonalPick> picks;bool done=false,save=false;
};

void RefreshPickList(PickDialogData* d){
    ListView_DeleteAllItems(d->list);
    for(int i=0;i<(int)d->picks.size();++i){
        std::wstring mode=d->picks[i].mode==PersonalPick::Mode::Pattern?L"Pattern":d->picks[i].mode==PersonalPick::Mode::Exact?L"Exact title":L"Phrase";
        LVITEMW it{LVIF_TEXT};it.iItem=i;it.pszText=(LPWSTR)mode.c_str();ListView_InsertItem(d->list,&it);ListView_SetItemText(d->list,i,1,(LPWSTR)d->picks[i].value.c_str());
    }
}
LRESULT CALLBACK PickProc(HWND h,UINT m,WPARAM w,LPARAM l){
    auto*d=(PickDialogData*)GetWindowLongPtrW(h,GWLP_USERDATA);
    if(m==WM_NCCREATE){d=(PickDialogData*)((CREATESTRUCTW*)l)->lpCreateParams;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)d);DarkTitle(h);}
    if(!d)return DefWindowProcW(h,m,w,l);
    switch(m){
    case WM_CREATE:{
        MakeCtrl(h,L"STATIC",L"Personal Picks",SS_LEFT,2200);
        MakeCtrl(h,L"STATIC",L"Persistent phrase, exact-title, and unusual-pattern choices. Save switches still control Remix/Live globally.",SS_LEFT,2201);
        d->edit=MakeCtrl(h,L"EDIT",L"",WS_BORDER|ES_AUTOHSCROLL|WS_TABSTOP,IDC_PICK_EDIT);
        MakeCtrl(h,L"BUTTON",L"Add phrase",BS_PUSHBUTTON|WS_TABSTOP,IDC_PICK_PHRASE);
        MakeCtrl(h,L"BUTTON",L"Add exact title",BS_PUSHBUTTON|WS_TABSTOP,IDC_PICK_EXACT);
        d->list=MakeCtrl(h,WC_LISTVIEWW,L"",LVS_REPORT|LVS_SINGLESEL|WS_TABSTOP,IDC_PICK_LIST);
        ListView_SetExtendedListViewStyle(d->list,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER);
        LVCOLUMNW c{LVCF_TEXT|LVCF_WIDTH};c.pszText=(LPWSTR)L"Mode";c.cx=100;ListView_InsertColumn(d->list,0,&c);c.pszText=(LPWSTR)L"Value";c.cx=520;ListView_InsertColumn(d->list,1,&c);
        MakeCtrl(h,L"BUTTON",L"Remove selected",BS_PUSHBUTTON|WS_TABSTOP,IDC_PICK_REMOVE);
        MakeCtrl(h,L"BUTTON",L"Cancel",BS_PUSHBUTTON|WS_TABSTOP,IDC_CANCEL);
        MakeCtrl(h,L"BUTTON",L"Save",BS_DEFPUSHBUTTON|WS_TABSTOP,IDC_PICK_SAVE);
        for(HWND c0=GetWindow(h,GW_CHILD);c0;c0=GetWindow(c0,GW_HWNDNEXT))ThemeCtrl(c0);SetFontAll(h,(HFONT)GetStockObject(DEFAULT_GUI_FONT));RefreshPickList(d);return 0;}
    case WM_SIZE:{int W=LOWORD(l),H=HIWORD(l),p=16;MoveWindow(GetDlgItem(h,2200),p,p,W-2*p,26,TRUE);MoveWindow(GetDlgItem(h,2201),p,42,W-2*p,32,TRUE);
        MoveWindow(d->edit,p,80,W-260,30,TRUE);MoveWindow(GetDlgItem(h,IDC_PICK_PHRASE),W-236,80,104,30,TRUE);MoveWindow(GetDlgItem(h,IDC_PICK_EXACT),W-124,80,108,30,TRUE);
        MoveWindow(d->list,p,120,W-2*p,H-180,TRUE);MoveWindow(GetDlgItem(h,IDC_PICK_REMOVE),p,H-48,116,32,TRUE);MoveWindow(GetDlgItem(h,IDC_CANCEL),W-198,H-48,84,32,TRUE);MoveWindow(GetDlgItem(h,IDC_PICK_SAVE),W-106,H-48,90,32,TRUE);return 0;}
    case WM_COMMAND:{
        int id=LOWORD(w);
        if(id==IDC_PICK_PHRASE||id==IDC_PICK_EXACT){auto v=TrimUi(GetText(d->edit));if(!v.empty()){PersonalPick p;p.mode=id==IDC_PICK_EXACT?PersonalPick::Mode::Exact:PersonalPick::Mode::Contains;p.value=v;d->picks.push_back(p);PutText(d->edit,L"");RefreshPickList(d);}}
        else if(id==IDC_PICK_REMOVE){int sel=ListView_GetNextItem(d->list,-1,LVNI_SELECTED);if(sel>=0&&sel<(int)d->picks.size()){d->picks.erase(d->picks.begin()+sel);RefreshPickList(d);}}
        else if(id==IDC_PICK_SAVE){d->save=true;d->done=true;DestroyWindow(h);}
        else if(id==IDC_CANCEL){d->save=false;d->done=true;DestroyWindow(h);}return 0;}
    case WM_CLOSE:d->save=false;d->done=true;DestroyWindow(h);return 0;
    case WM_CTLCOLOREDIT:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_FIELD);static HBRUSH b=CreateSolidBrush(C_FIELD);return(LRESULT)b;}
    case WM_CTLCOLORSTATIC:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_PANEL);return(LRESULT)GetStockObject(NULL_BRUSH);}
    case WM_ERASEBKGND:{RECT r;GetClientRect(h,&r);HBRUSH b=CreateSolidBrush(C_PANEL);FillRect((HDC)w,&r,b);DeleteObject(b);return 1;}
    }return DefWindowProcW(h,m,w,l);
}
bool RunPickDialog(HWND owner,std::vector<PersonalPick>& picks){
    static bool registered=false;if(!registered){WNDCLASSW wc{};wc.lpfnWndProc=PickProc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"DEA_Picks";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClassW(&wc);registered=true;}
    PickDialogData d;d.owner=owner;d.picks=picks;EnableWindow(owner,FALSE);
    HWND h=CreateWindowExW(WS_EX_DLGMODALFRAME,L"DEA_Picks",L"Personal Picks",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_THICKFRAME,CW_USEDEFAULT,CW_USEDEFAULT,780,610,owner,nullptr,GetModuleHandleW(nullptr),&d);
    ShowWindow(h,SW_SHOW);MSG msg;while(!d.done&&GetMessageW(&msg,nullptr,0,0)>0){if(!IsDialogMessageW(h,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}}
    EnableWindow(owner,TRUE);SetForegroundWindow(owner);if(d.save)picks=d.picks;return d.save;
}

uint64_t CountSelectedTracks(const AnalysisResult& r){
    uint64_t n=0;for(int rid:r.selectedReleases){if(rid<0||rid>=(int)r.releases.size())continue;for(int ti:r.releases[rid].trackIndices)if(ti>=0&&ti<(int)r.tracks.size()&&!r.tracks[ti].excluded&&!r.tracks[ti].manualSkip)++n;}return n;
}

std::wstring StateText(const Release& r,bool selected){
    if(r.pendingIgnore)return L"PENDING IGNORE";
    if(r.pendingRestore)return L"PENDING RESTORE";
    if(r.manualRemoved||r.blocked)return L"IGNORED BY YOU";
    return selected?L"Retained":L"Duplicate";
}

struct PatternRequest {
    std::vector<std::pair<std::wstring,int>> patterns;
    std::set<std::wstring> pre;
    std::set<std::wstring> result;
    bool accepted=false;
};

struct FinishMsg{bool ok;std::wstring error;};

} // namespace

MainWindow::MainWindow(HINSTANCE i):instance_(i),settings_(engine_.LoadSettings()){}

int MainWindow::Run(){
    INITCOMMONCONTROLSEX ic{sizeof(ic),ICC_STANDARD_CLASSES|ICC_PROGRESS_CLASS|ICC_LISTVIEW_CLASSES};InitCommonControlsEx(&ic);
    WNDCLASSW wc{};wc.lpfnWndProc=WndProc;wc.hInstance=instance_;wc.lpszClassName=L"DEA_Native_Main";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);wc.hbrBackground=nullptr;
    RegisterClassW(&wc);
    hwnd_=CreateWindowExW(0,wc.lpszClassName,L"Duplicate / Edition Analyzer Native 0.1.1",WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN,CW_USEDEFAULT,CW_USEDEFAULT,1180,780,nullptr,nullptr,instance_,this);
    if(!hwnd_)return 1;ShowWindow(hwnd_,SW_SHOW);UpdateWindow(hwnd_);
    MSG m;while(GetMessageW(&m,nullptr,0,0)>0){TranslateMessage(&m);DispatchMessageW(&m);}
    cancel_=true;if(worker_.joinable())worker_.join();
    return (int)m.wParam;
}

LRESULT CALLBACK MainWindow::WndProc(HWND h,UINT m,WPARAM w,LPARAM l){
    MainWindow* self=(MainWindow*)GetWindowLongPtrW(h,GWLP_USERDATA);
    if(m==WM_NCCREATE){self=(MainWindow*)((CREATESTRUCTW*)l)->lpCreateParams;self->hwnd_=h;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)self);DarkTitle(h);}
    return self?self->HandleMessage(m,w,l):DefWindowProcW(h,m,w,l);
}

void MainWindow::CreateUi(){
    UINT dpi=GetDpiForWindow(hwnd_);
    auto mkfont=[&](int pt,int weight,const wchar_t* face){return CreateFontW(-MulDiv(pt,(int)dpi,72),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,face);};
    font_=mkfont(9,FW_NORMAL,L"Segoe UI");fontBold_=mkfont(10,FW_BOLD,L"Segoe UI");fontMajor_=mkfont(15,FW_BOLD,L"Segoe UI");fontMono_=mkfont(9,FW_NORMAL,L"Cascadia Mono");
    bgBrush_=CreateSolidBrush(C_BG);panelBrush_=CreateSolidBrush(C_PANEL);fieldBrush_=CreateSolidBrush(C_FIELD);

    auto title=MakeCtrl(hwnd_,L"STATIC",L"Duplicate / Edition Analyzer",SS_LEFT,2200);SendMessage(title,WM_SETFONT,(WPARAM)fontMajor_,TRUE);
    auto ver=MakeCtrl(hwnd_,L"STATIC",L"v0.1.1",SS_LEFT,2201);
    auto stat=MakeCtrl(hwnd_,L"STATIC",STATUS_TEXT,SS_RIGHT,2202);

    MakeCtrl(hwnd_,L"STATIC",L"Source folders",SS_LEFT,2210);
    MakeCtrl(hwnd_,L"STATIC",L"Existing discography   optional",SS_LEFT,2211);
    auto open1=MakeCtrl(hwnd_,L"BUTTON",L"\xD83D\xDCC1",BS_PUSHBUTTON|WS_TABSTOP,IDC_OPEN_EXISTING);
    existingEdit_=MakeCtrl(hwnd_,L"EDIT",settings_.existing.c_str(),WS_BORDER|ES_AUTOHSCROLL|WS_TABSTOP,IDC_EXISTING);
    MakeCtrl(hwnd_,L"BUTTON",L"Browse...",BS_PUSHBUTTON|WS_TABSTOP,IDC_BROWSE_EXISTING);
    MakeCtrl(hwnd_,L"BUTTON",L"Clear",BS_PUSHBUTTON|WS_TABSTOP,IDC_CLEAR_EXISTING);

    MakeCtrl(hwnd_,L"STATIC",L"New / update releases",SS_LEFT,2212);
    auto open2=MakeCtrl(hwnd_,L"BUTTON",L"\xD83D\xDCC1",BS_PUSHBUTTON|WS_TABSTOP,IDC_OPEN_INCOMING);
    incomingEdit_=MakeCtrl(hwnd_,L"EDIT",settings_.incoming.c_str(),WS_BORDER|ES_AUTOHSCROLL|WS_TABSTOP,IDC_INCOMING);
    MakeCtrl(hwnd_,L"BUTTON",L"Browse...",BS_PUSHBUTTON|WS_TABSTOP,IDC_BROWSE_INCOMING);

    saveRemixes_=MakeCtrl(hwnd_,L"BUTTON",L"Save Remixes",BS_AUTOCHECKBOX|WS_TABSTOP,IDC_SAVE_REMIXES);
    saveLive_=MakeCtrl(hwnd_,L"BUTTON",L"Save Live recordings",BS_AUTOCHECKBOX|WS_TABSTOP,IDC_SAVE_LIVE);
    logging_=MakeCtrl(hwnd_,L"BUTTON",L"Logging",BS_AUTOCHECKBOX|WS_TABSTOP,IDC_LOGGING);
    personal_=MakeCtrl(hwnd_,L"BUTTON",L"Personal Picks...",BS_PUSHBUTTON|WS_TABSTOP,IDC_PERSONAL);
    openLogs_=MakeCtrl(hwnd_,L"BUTTON",L"\xD83D\xDCC1",BS_PUSHBUTTON|WS_TABSTOP,IDC_OPEN_LOGS);

    Button_SetCheck(saveRemixes_,settings_.saveRemixes?BST_CHECKED:BST_UNCHECKED);
    Button_SetCheck(saveLive_,settings_.saveLive?BST_CHECKED:BST_UNCHECKED);
    Button_SetCheck(logging_,settings_.logging?BST_CHECKED:BST_UNCHECKED);

    status_=MakeCtrl(hwnd_,L"STATIC",L"Ready",SS_LEFT,IDC_STATUS);SendMessage(status_,WM_SETFONT,(WPARAM)fontBold_,TRUE);
    progress_=MakeCtrl(hwnd_,PROGRESS_CLASSW,L"",PBS_SMOOTH,IDC_PROGRESS);SendMessage(progress_,PBM_SETRANGE,0,MAKELPARAM(0,1000));SendMessage(progress_,PBM_SETBARCOLOR,0,RGB(76,147,206));
    detail_=MakeCtrl(hwnd_,L"STATIC",L"",SS_LEFT,IDC_DETAIL);
    MakeCtrl(hwnd_,L"STATIC",L"Activity",SS_LEFT,2213);
    activity_=MakeCtrl(hwnd_,L"EDIT",L"",ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|WS_VSCROLL|WS_BORDER,IDC_ACTIVITY);SendMessage(activity_,WM_SETFONT,(WPARAM)fontMono_,TRUE);

    analyze_=MakeCtrl(hwnd_,L"BUTTON",L"Analyze",BS_DEFPUSHBUTTON|WS_TABSTOP,IDC_ANALYZE);
    undo_=MakeCtrl(hwnd_,L"BUTTON",L"Undo last run",BS_PUSHBUTTON|WS_TABSTOP,IDC_UNDO);
    map_=MakeCtrl(hwnd_,L"BUTTON",L"Release Map...",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP);
    MakeCtrl(hwnd_,L"BUTTON",L"Close",BS_PUSHBUTTON|WS_TABSTOP,IDC_CLOSE);

    for(HWND c=GetWindow(hwnd_,GW_CHILD);c;c=GetWindow(c,GW_HWNDNEXT)){if(c!=title)SendMessage(c,WM_SETFONT,(WPARAM)font_,TRUE);ThemeCtrl(c);}
    SendMessage(GetDlgItem(hwnd_,2210),WM_SETFONT,(WPARAM)fontBold_,TRUE);SendMessage(GetDlgItem(hwnd_,2213),WM_SETFONT,(WPARAM)fontBold_,TRUE);
    ThemeCtrl(open1);ThemeCtrl(open2);UpdateButtons();
}

void MainWindow::Layout(int W,int H){
    int p=Scale(hwnd_,16),gap=Scale(hwnd_,8),row=Scale(hwnd_,34),button=Scale(hwnd_,90),icon=Scale(hwnd_,34);
    MoveWindow(GetDlgItem(hwnd_,2200),p,Scale(hwnd_,16),Scale(hwnd_,340),Scale(hwnd_,30),TRUE);
    MoveWindow(GetDlgItem(hwnd_,2201),Scale(hwnd_,365),Scale(hwnd_,23),Scale(hwnd_,90),Scale(hwnd_,20),TRUE);
    MoveWindow(GetDlgItem(hwnd_,2202),W-p-Scale(hwnd_,190),Scale(hwnd_,20),Scale(hwnd_,190),Scale(hwnd_,22),TRUE);

    int y=Scale(hwnd_,66);MoveWindow(GetDlgItem(hwnd_,2210),p,y,W-2*p,Scale(hwnd_,25),TRUE);y+=Scale(hwnd_,28);
    MoveWindow(GetDlgItem(hwnd_,2211),p,y,W-2*p,Scale(hwnd_,22),TRUE);y+=Scale(hwnd_,24);
    MoveWindow(GetDlgItem(hwnd_,IDC_OPEN_EXISTING),p,y,icon,row,TRUE);
    MoveWindow(existingEdit_,p+icon+gap,y,W-2*p-icon-gap-button*2-gap*2,row,TRUE);
    int x=W-p-button*2-gap;MoveWindow(GetDlgItem(hwnd_,IDC_BROWSE_EXISTING),x,y,button,row,TRUE);MoveWindow(GetDlgItem(hwnd_,IDC_CLEAR_EXISTING),x+button+gap,y,button,row,TRUE);y+=row+gap;
    MoveWindow(GetDlgItem(hwnd_,2212),p,y,W-2*p,Scale(hwnd_,22),TRUE);y+=Scale(hwnd_,24);
    MoveWindow(GetDlgItem(hwnd_,IDC_OPEN_INCOMING),p,y,icon,row,TRUE);
    MoveWindow(incomingEdit_,p+icon+gap,y,W-2*p-icon-gap-button-gap,row,TRUE);MoveWindow(GetDlgItem(hwnd_,IDC_BROWSE_INCOMING),W-p-button,y,button,row,TRUE);y+=row+Scale(hwnd_,14);

    int optY=y;MoveWindow(saveRemixes_,p,optY,Scale(hwnd_,112),row,TRUE);MoveWindow(saveLive_,p+Scale(hwnd_,122),optY,Scale(hwnd_,150),row,TRUE);
    MoveWindow(logging_,p+Scale(hwnd_,282),optY,Scale(hwnd_,82),row,TRUE);MoveWindow(openLogs_,p+Scale(hwnd_,368),optY,icon,row,TRUE);MoveWindow(personal_,p+Scale(hwnd_,410),optY,Scale(hwnd_,125),row,TRUE);
    y+=row+Scale(hwnd_,16);

    MoveWindow(status_,p,y,W-2*p-Scale(hwnd_,80),Scale(hwnd_,24),TRUE);y+=Scale(hwnd_,27);
    MoveWindow(progress_,p,y,W-2*p,Scale(hwnd_,10),TRUE);y+=Scale(hwnd_,16);
    MoveWindow(detail_,p,y,W-2*p,Scale(hwnd_,22),TRUE);y+=Scale(hwnd_,30);
    MoveWindow(GetDlgItem(hwnd_,2213),p,y,W-2*p,Scale(hwnd_,22),TRUE);y+=Scale(hwnd_,25);
    int footer=Scale(hwnd_,58);MoveWindow(activity_,p,y,W-2*p,std::max(Scale(hwnd_,120),H-y-footer-Scale(hwnd_,10)),TRUE);

    int fy=H-footer+Scale(hwnd_,10);MoveWindow(analyze_,p,fy,Scale(hwnd_,90),Scale(hwnd_,34),TRUE);MoveWindow(undo_,p+Scale(hwnd_,98),fy,Scale(hwnd_,110),Scale(hwnd_,34),TRUE);MoveWindow(map_,p+Scale(hwnd_,216),fy,Scale(hwnd_,110),Scale(hwnd_,34),TRUE);MoveWindow(GetDlgItem(hwnd_,IDC_CLOSE),W-p-Scale(hwnd_,82),fy,Scale(hwnd_,82),Scale(hwnd_,34),TRUE);
}

void MainWindow::BrowseInto(HWND edit){auto cur=fs::path(Text(edit));if(auto p=PickFolder(hwnd_,cur)){SetText(edit,p->wstring());SaveUiSettings();}}
void MainWindow::OpenDisplayedPath(HWND edit){std::wstring e;if(!OpenPathLocation(fs::path(Text(edit)),e))MessageBoxW(hwnd_,L"The displayed path could not be opened. It remains unchanged.",APP_NAME,MB_OK|MB_ICONWARNING);}
std::wstring MainWindow::Text(HWND h)const{return GetText(h);}
void MainWindow::SetText(HWND h,const std::wstring&s){PutText(h,s);}

void MainWindow::SaveUiSettings(){
    settings_.existing=Text(existingEdit_);settings_.incoming=Text(incomingEdit_);
    settings_.saveRemixes=Button_GetCheck(saveRemixes_)==BST_CHECKED;settings_.saveLive=Button_GetCheck(saveLive_)==BST_CHECKED;settings_.logging=Button_GetCheck(logging_)==BST_CHECKED;
    engine_.SaveSettings(settings_);
}

void MainWindow::AppendActivity(const std::wstring& line){
    SYSTEMTIME st{};GetLocalTime(&st);wchar_t t[16]{};swprintf_s(t,L"%02d:%02d:%02d ",st.wHour,st.wMinute,st.wSecond);
    std::wstring add=t+line+L"\r\n";int len=GetWindowTextLengthW(activity_);SendMessageW(activity_,EM_SETSEL,len,len);SendMessageW(activity_,EM_REPLACESEL,FALSE,(LPARAM)add.c_str());SendMessageW(activity_,EM_SCROLLCARET,0,0);
}
void MainWindow::SetProgress(const Progress&p){
    PutText(status_,p.stage);
    int pos=p.total?int(std::min<uint64_t>(1000,p.current*1000/p.total)):0;SendMessage(progress_,PBM_SETPOS,pos,0);
    std::wstringstream ss;
    if(p.total){
        bool download=p.stage.rfind(L"Downloading ",0)==0;
        if(download){
            auto human=[](uint64_t bytes){
                std::wstringstream out;
                if(bytes>=1000000000ULL)out<<std::fixed<<std::setprecision(2)<<(double)bytes/1000000000.0<<L" GB";
                else if(bytes>=1000000ULL)out<<std::fixed<<std::setprecision(1)<<(double)bytes/1000000.0<<L" MB";
                else if(bytes>=1000ULL)out<<std::fixed<<std::setprecision(1)<<(double)bytes/1000.0<<L" KB";
                else out<<bytes<<L" B";
                return out.str();
            };
            ss<<human(p.current)<<L" / "<<human(p.total)<<L" ("<<(p.current*100/p.total)<<L"%)";
        }else{
            ss<<p.current<<L" / "<<p.total<<L" ("<<(p.current*100/p.total)<<L"%)";
        }
    }
    if(p.rate>0)ss<<L"  |  "<<std::fixed<<std::setprecision(1)<<p.rate<<L"/s";
    PutText(detail_,ss.str());
}
void MainWindow::UpdateButtons(){
    EnableWindow(analyze_,!running_);EnableWindow(undo_,!running_&&fs::exists(engine_.Paths().undoManifest));EnableWindow(map_,!running_&&!result_.releases.empty());
    EnableWindow(existingEdit_,!running_);EnableWindow(incomingEdit_,!running_);
    for(int id:{IDC_OPEN_EXISTING,IDC_BROWSE_EXISTING,IDC_CLEAR_EXISTING,IDC_OPEN_INCOMING,IDC_BROWSE_INCOMING,IDC_SAVE_REMIXES,IDC_SAVE_LIVE,IDC_LOGGING,IDC_PERSONAL,IDC_OPEN_LOGS})EnableWindow(GetDlgItem(hwnd_,id),!running_);
}

void MainWindow::OpenUnusualPatternReview(const std::vector<std::pair<std::wstring,int>>& patterns,std::set<std::wstring>& kept){
    std::set<std::wstring> pre;
    for(auto&p:settings_.personalPicks)if(p.mode==PersonalPick::Mode::Pattern)pre.insert(p.key.empty()?Engine::Normalize(p.value):p.key);
    bool accepted=false;auto chosen=RunChecklist(hwnd_,patterns,pre,accepted);
    if(!accepted){cancel_=true;kept.clear();return;}kept=chosen;
    std::set<std::wstring> existing=pre;
    for(auto&k:chosen)if(!existing.count(k)){PersonalPick p;p.mode=PersonalPick::Mode::Pattern;p.value=k;p.key=k;settings_.personalPicks.push_back(p);}
    engine_.SaveSettings(settings_);
}

void MainWindow::StartAnalyze(){
    if(running_)return;SaveUiSettings();cancel_=false;PutText(activity_,L"");AppendActivity(L"Started");running_=true;UpdateButtons();
    AnalysisOptions options;options.saveRemixes=settings_.saveRemixes;options.saveLive=settings_.saveLive;options.logging=settings_.logging;options.personalPicks=settings_.personalPicks;
    if(worker_.joinable())worker_.join();
    worker_=std::thread([this,options]{
        AnalysisResult local;std::wstring error;
        auto progress=[this](const Progress&p){PostMessageW(hwnd_,WM_DEA_PROGRESS,0,(LPARAM)new Progress(p));};
        auto log=[this](const std::wstring&s){PostMessageW(hwnd_,WM_DEA_LOG,0,(LPARAM)new std::wstring(s));};
        auto review=[this](const std::vector<std::pair<std::wstring,int>>&p){
            auto*r=new PatternRequest;r->patterns=p;for(auto&x:settings_.personalPicks)if(x.mode==PersonalPick::Mode::Pattern)r->pre.insert(x.key.empty()?Engine::Normalize(x.value):x.key);
            SendMessageW(hwnd_,WM_DEA_PATTERN_REVIEW,0,(LPARAM)r);auto out=r->result;bool ok=r->accepted;delete r;if(!ok)cancel_=true;return out;
        };
        bool ok=engine_.Analyze(settings_,options,local,review,progress,log,cancel_,error);
        if(ok){std::lock_guard lk(resultMutex_);result_=std::move(local);}
        PostMessageW(hwnd_,WM_DEA_FINISHED,0,(LPARAM)new FinishMsg{ok,error});
    });
}

void MainWindow::FinishAnalyze(bool ok,const std::wstring& error){
    if(worker_.joinable())worker_.join();running_=false;
    if(ok){
        initialReleaseCount_=result_.selectedReleases.size();initialTrackCount_=CountSelectedTracks(result_);
        AppendActivity(L"Analysis complete");PutText(status_,L"Ready - analysis complete");SendMessage(progress_,PBM_SETPOS,1000,0);
    }else if(cancel_){AppendActivity(L"Cancelled");PutText(status_,L"Cancelled");SendMessage(progress_,PBM_SETPOS,0,0);}
    else{AppendActivity(L"Analysis failed");PutText(status_,L"Error");MessageBoxW(hwnd_,L"Analysis failed. See Activity for the stage that failed.",APP_NAME,MB_OK|MB_ICONERROR);if(!error.empty())AppendActivity(L"Error details recorded without exposing raw filesystem paths in the dialog.");}
    UpdateButtons();
}

void MainWindow::OpenPersonalPicks(){
    auto picks=settings_.personalPicks;if(RunPickDialog(hwnd_,picks)){settings_.personalPicks=std::move(picks);engine_.SaveSettings(settings_);AppendActivity(L"Personal Picks updated");}
}

struct MapState{
    MainWindow* main{};
    HWND hwnd{},search{},releases{},path{},tracks{},initial{},result{},info{};
    int selectedRelease{-1};
    int selectedTrack{-1};
    bool dirty=false;
};

static MapState* MapData(HWND h){return (MapState*)GetWindowLongPtrW(h,GWLP_USERDATA);}

static void PopulateMap(MapState*d){
    ListView_DeleteAllItems(d->releases);std::wstring q=Engine::Normalize(GetText(d->search));
    int row=0;
    for(auto&r:d->main->Result().releases){
        if(!q.empty()&&Engine::Normalize(r.title).find(q)==std::wstring::npos)continue;
        std::wstring st=StateText(r,d->main->Result().selectedReleases.count(r.id)>0);
        LVITEMW it{LVIF_TEXT|LVIF_PARAM};it.iItem=row;it.lParam=r.id;it.pszText=(LPWSTR)r.title.c_str();ListView_InsertItem(d->releases,&it);
        ListView_SetItemText(d->releases,row,1,(LPWSTR)st.c_str());
        ListView_SetItemText(d->releases,row,2,(LPWSTR)std::to_wstring(r.groups.size()).c_str());
        ListView_SetItemText(d->releases,row,3,(LPWSTR)std::to_wstring(r.trackIndices.size()).c_str());++row;
    }
    auto curR=d->main->Result().selectedReleases.size(),curT=CountSelectedTracks(d->main->Result());
    PutText(d->initial,L"Initial: "+std::to_wstring(d->main->InitialReleaseCount())+L" releases / "+std::to_wstring(d->main->InitialTrackCount())+L" tracks");
    PutText(d->result,L"Result: "+std::to_wstring(curR)+L" releases ("+std::to_wstring((int64_t)curR-(int64_t)d->main->InitialReleaseCount())+L") / "+std::to_wstring(curT)+L" tracks ("+std::to_wstring((int64_t)curT-(int64_t)d->main->InitialTrackCount())+L")"+(d->dirty?L" - pending Re-Analyze":L""));
}
static void ShowReleaseDetails(MapState*d,int rid){
    d->selectedRelease=rid;d->selectedTrack=-1;if(rid<0||rid>=(int)d->main->Result().releases.size())return;
    auto&r=d->main->Result().releases[rid];PutText(d->path,r.path.wstring());ListView_DeleteAllItems(d->tracks);int row=0;
    for(int ti:r.trackIndices){if(ti<0||ti>=(int)d->main->Result().tracks.size())continue;auto&t=d->main->Result().tracks[ti];
        std::wstring state=t.excluded?L"Skipped":t.manualSkip?L"Ignored by you":L"Included";
        LVITEMW it{LVIF_TEXT|LVIF_PARAM};it.iItem=row;it.lParam=ti;it.pszText=(LPWSTR)t.title.c_str();ListView_InsertItem(d->tracks,&it);ListView_SetItemText(d->tracks,row,1,(LPWSTR)state.c_str());ListView_SetItemText(d->tracks,row,2,(LPWSTR)std::to_wstring(t.groupId).c_str());++row;}
    PutText(d->info,StateText(r,d->main->Result().selectedReleases.count(r.id)>0)+L"  |  "+std::to_wstring(r.groups.size())+L" unique wanted groups");
    PutText(GetDlgItem(d->hwnd,IDC_MAP_IGNORE_RELEASE),r.blocked?L"Restore release":L"Ignore release");
}
static void ReoptMap(MapState*d){
    AnalysisOptions o;o.saveRemixes=d->main->CurrentSettings().saveRemixes;o.saveLive=d->main->CurrentSettings().saveLive;o.logging=d->main->CurrentSettings().logging;o.personalPicks=d->main->CurrentSettings().personalPicks;
    for(auto&r:d->main->Result().releases)if(r.blocked)o.blockedReleaseIds.insert(r.id);
    std::wstring err;PutText(d->info,L"Re-Analyzing plan...");
    d->main->Core().Reoptimize(d->main->Result(),o,nullptr,[&](const std::wstring&s){d->main->LogUi(s);},err);
    d->dirty=false;PopulateMap(d);if(d->selectedRelease>=0)ShowReleaseDetails(d,d->selectedRelease);
}

LRESULT CALLBACK MainWindow::ReleaseMapProc(HWND h,UINT m,WPARAM w,LPARAM l){
    MapState*d=MapData(h);
    if(m==WM_NCCREATE){auto*cs=(CREATESTRUCTW*)l;auto*main=(MainWindow*)cs->lpCreateParams;d=new MapState;d->main=main;d->hwnd=h;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)d);DarkTitle(h);}
    if(!d)return DefWindowProcW(h,m,w,l);
    switch(m){
    case WM_CREATE:{
        d->search=MakeCtrl(h,L"EDIT",L"",WS_BORDER|ES_AUTOHSCROLL|WS_TABSTOP,IDC_MAP_SEARCH);
        d->initial=MakeCtrl(h,L"STATIC",L"",SS_LEFT,IDC_MAP_INITIAL);d->result=MakeCtrl(h,L"STATIC",L"",SS_LEFT,IDC_MAP_RESULT);
        d->releases=MakeCtrl(h,WC_LISTVIEWW,L"",LVS_REPORT|LVS_SINGLESEL|WS_TABSTOP,IDC_MAP_RELEASES);ListView_SetExtendedListViewStyle(d->releases,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER);
        for(auto [name,wid]:std::vector<std::pair<const wchar_t*,int>>{{L"Release",430},{L"State",130},{L"Unique",70},{L"Tracks",70}}){LVCOLUMNW c{LVCF_TEXT|LVCF_WIDTH};c.pszText=(LPWSTR)name;c.cx=wid;ListView_InsertColumn(d->releases,ListView_GetHeader(d->releases)?Header_GetItemCount(ListView_GetHeader(d->releases)):0,&c);}
        MakeCtrl(h,L"STATIC",L"Release details",SS_LEFT,2200);d->info=MakeCtrl(h,L"STATIC",L"Select a release to inspect it.",SS_LEFT,IDC_MAP_INFO);
        MakeCtrl(h,L"BUTTON",L"\xD83D\xDCC1",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_OPEN_PATH);d->path=MakeCtrl(h,L"EDIT",L"",WS_BORDER|ES_AUTOHSCROLL|ES_READONLY|WS_TABSTOP,IDC_MAP_PATH);MakeCtrl(h,L"BUTTON",L"Copy path",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_COPY);
        MakeCtrl(h,L"BUTTON",L"Ignore release",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_IGNORE_RELEASE);
        d->tracks=MakeCtrl(h,WC_LISTVIEWW,L"",LVS_REPORT|LVS_SINGLESEL|WS_TABSTOP,IDC_MAP_TRACKS);ListView_SetExtendedListViewStyle(d->tracks,LVS_EX_FULLROWSELECT|LVS_EX_DOUBLEBUFFER);
        for(auto [name,wid]:std::vector<std::pair<const wchar_t*,int>>{{L"Track",410},{L"State",120},{L"Group",70}}){LVCOLUMNW c{LVCF_TEXT|LVCF_WIDTH};c.pszText=(LPWSTR)name;c.cx=wid;ListView_InsertColumn(d->tracks,ListView_GetHeader(d->tracks)?Header_GetItemCount(ListView_GetHeader(d->tracks)):0,&c);}
        MakeCtrl(h,L"BUTTON",L"Ignore selected track",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_IGNORE_TRACK);MakeCtrl(h,L"BUTTON",L"Re-Analyze",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_REANALYZE);MakeCtrl(h,L"BUTTON",L"Apply file changes",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_APPLY);MakeCtrl(h,L"BUTTON",L"Close",BS_PUSHBUTTON|WS_TABSTOP,IDC_MAP_CLOSE);
        for(HWND c=GetWindow(h,GW_CHILD);c;c=GetWindow(c,GW_HWNDNEXT)){ThemeCtrl(c);SendMessage(c,WM_SETFONT,(WPARAM)d->main->UiFont(),TRUE);}PopulateMap(d);return 0;}
    case WM_SIZE:{int W=LOWORD(l),H=HIWORD(l),p=12,top=78,right=480;
        MoveWindow(d->initial,p,10,360,22,TRUE);MoveWindow(d->result,p,34,520,22,TRUE);MoveWindow(d->search,W-300-p,20,300,30,TRUE);
        MoveWindow(d->releases,p,top,W-right-3*p,H-top-56,TRUE);
        int x=W-right-2*p;MoveWindow(GetDlgItem(h,2200),x,top,right,24,TRUE);MoveWindow(d->info,x,top+26,right,34,TRUE);MoveWindow(GetDlgItem(h,IDC_MAP_OPEN_PATH),x,top+66,34,32,TRUE);MoveWindow(d->path,x+40,top+66,right-150,32,TRUE);MoveWindow(GetDlgItem(h,IDC_MAP_COPY),x+right-104,top+66,104,32,TRUE);
        MoveWindow(GetDlgItem(h,IDC_MAP_IGNORE_RELEASE),x,top+106,130,32,TRUE);MoveWindow(d->tracks,x,top+146,right,H-top-260,TRUE);MoveWindow(GetDlgItem(h,IDC_MAP_IGNORE_TRACK),x,H-106,150,32,TRUE);
        MoveWindow(GetDlgItem(h,IDC_MAP_REANALYZE),p,H-44,100,32,TRUE);MoveWindow(GetDlgItem(h,IDC_MAP_APPLY),p+110,H-44,140,32,TRUE);MoveWindow(GetDlgItem(h,IDC_MAP_CLOSE),W-p-80,H-44,80,32,TRUE);return 0;}
    case WM_NOTIFY:{
        auto*hdr=(NMHDR*)l;if(hdr->idFrom==IDC_MAP_RELEASES&&hdr->code==LVN_ITEMCHANGED){auto*nm=(NMLISTVIEW*)l;if((nm->uNewState&LVIS_SELECTED)&&nm->iItem>=0){LVITEMW it{LVIF_PARAM};it.iItem=nm->iItem;ListView_GetItem(d->releases,&it);ShowReleaseDetails(d,(int)it.lParam);}}
        if(hdr->idFrom==IDC_MAP_TRACKS&&hdr->code==LVN_ITEMCHANGED){auto*nm=(NMLISTVIEW*)l;if((nm->uNewState&LVIS_SELECTED)&&nm->iItem>=0){LVITEMW it{LVIF_PARAM};it.iItem=nm->iItem;ListView_GetItem(d->tracks,&it);d->selectedTrack=(int)it.lParam;auto&t=d->main->Result().tracks[d->selectedTrack];PutText(GetDlgItem(h,IDC_MAP_IGNORE_TRACK),t.manualSkip?L"Restore selected track":L"Ignore selected track");}}return 0;}
    case WM_COMMAND:{
        int id=LOWORD(w);
        if(id==IDC_MAP_SEARCH&&HIWORD(w)==EN_CHANGE)PopulateMap(d);
        else if(id==IDC_MAP_OPEN_PATH&&d->selectedRelease>=0){std::wstring e;auto&p=d->main->Result().releases[d->selectedRelease].path;if(!OpenPathLocation(p,e))MessageBoxW(h,L"The displayed release path could not be opened. It remains unchanged.",APP_NAME,MB_OK|MB_ICONWARNING);}
        else if(id==IDC_MAP_COPY){OpenClipboard(h);EmptyClipboard();auto s=GetText(d->path);size_t bytes=(s.size()+1)*sizeof(wchar_t);HGLOBAL mem=GlobalAlloc(GMEM_MOVEABLE,bytes);memcpy(GlobalLock(mem),s.c_str(),bytes);GlobalUnlock(mem);SetClipboardData(CF_UNICODETEXT,mem);CloseClipboard();}
        else if(id==IDC_MAP_IGNORE_RELEASE&&d->selectedRelease>=0){auto&r=d->main->Result().releases[d->selectedRelease];r.blocked=!r.blocked;r.manualRemoved=r.blocked;r.pendingIgnore=r.blocked;r.pendingRestore=!r.blocked;d->dirty=true;PopulateMap(d);ShowReleaseDetails(d,r.id);}
        else if(id==IDC_MAP_IGNORE_TRACK&&d->selectedTrack>=0){auto&t=d->main->Result().tracks[d->selectedTrack];t.manualSkip=!t.manualSkip;d->dirty=true;ShowReleaseDetails(d,d->selectedRelease);PopulateMap(d);}
        else if(id==IDC_MAP_REANALYZE){ReoptMap(d);}
        else if(id==IDC_MAP_APPLY){
            if(d->dirty){MessageBoxW(h,L"Run Re-Analyze before applying file changes.",APP_NAME,MB_OK|MB_ICONINFORMATION);}
            else if(MessageBoxW(h,L"Apply file changes now?\n\nThis will move/remove files according to the current plan. Undo last run will remain available.",APP_NAME,MB_YESNO|MB_ICONWARNING)==IDYES){
                std::wstring e;if(d->main->Core().ApplyPlan(d->main->Result(),d->main->CurrentSettings(),[&](const std::wstring&s){d->main->LogUi(s);},e)){MessageBoxW(h,L"File changes applied. Undo last run is available from the main window.",APP_NAME,MB_OK|MB_ICONINFORMATION);d->main->RefreshButtons();}
                else MessageBoxW(h,L"Apply failed. No further file operations were performed after the error.",APP_NAME,MB_OK|MB_ICONERROR);
            }}
        else if(id==IDC_MAP_CLOSE)DestroyWindow(h);return 0;}
    case WM_CTLCOLORSTATIC:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_PANEL);return(LRESULT)d->main->PanelBrush();}
    case WM_CTLCOLOREDIT:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_FIELD);return(LRESULT)d->main->FieldBrush();}
    case WM_ERASEBKGND:{RECT r;GetClientRect(h,&r);FillRect((HDC)w,&r,d->main->PanelBrush());return 1;}
    case WM_DESTROY:delete d;SetWindowLongPtrW(h,GWLP_USERDATA,0);return 0;
    }return DefWindowProcW(h,m,w,l);
}

void MainWindow::OpenReleaseMap(){
    static bool registered=false;if(!registered){WNDCLASSW wc{};wc.lpfnWndProc=ReleaseMapProc;wc.hInstance=instance_;wc.lpszClassName=L"DEA_Native_Map";wc.hCursor=LoadCursor(nullptr,IDC_ARROW);RegisterClassW(&wc);registered=true;}
    HWND h=CreateWindowExW(0,L"DEA_Native_Map",L"Duplicate / Edition Analyzer Native - Release Map",WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN,CW_USEDEFAULT,CW_USEDEFAULT,1500,900,hwnd_,nullptr,instance_,this);
    ShowWindow(h,SW_SHOW);UpdateWindow(h);
}

LRESULT MainWindow::HandleMessage(UINT m,WPARAM w,LPARAM l){
    switch(m){
    case WM_CREATE:CreateUi();return 0;
    case WM_SIZE:Layout(LOWORD(l),HIWORD(l));return 0;
    case WM_COMMAND:{
        int id=LOWORD(w);
        if(id==IDC_BROWSE_EXISTING)BrowseInto(existingEdit_);
        else if(id==IDC_BROWSE_INCOMING)BrowseInto(incomingEdit_);
        else if(id==IDC_OPEN_EXISTING)OpenDisplayedPath(existingEdit_);
        else if(id==IDC_OPEN_INCOMING)OpenDisplayedPath(incomingEdit_);
        else if(id==IDC_CLEAR_EXISTING){SetText(existingEdit_,L"");SaveUiSettings();}
        else if(id==IDC_PERSONAL)OpenPersonalPicks();
        else if(id==IDC_OPEN_LOGS){std::wstring e;OpenPathLocation(engine_.Paths().logs,e);}
        else if(id==IDC_ANALYZE)StartAnalyze();
        else if(id==IDC_UNDO){if(MessageBoxW(hwnd_,L"Undo the last applied filesystem changes?",APP_NAME,MB_YESNO|MB_ICONQUESTION)==IDYES){std::wstring e;if(engine_.UndoLastRun([&](const std::wstring&s){AppendActivity(s);},e))AppendActivity(L"Undo complete");else MessageBoxW(hwnd_,L"Undo could not be completed.",APP_NAME,MB_OK|MB_ICONERROR);UpdateButtons();}}
        else if(id==IDC_MAP)OpenReleaseMap();
        else if(id==IDC_CLOSE)SendMessage(hwnd_,WM_CLOSE,0,0);
        else if(id==IDC_SAVE_REMIXES||id==IDC_SAVE_LIVE||id==IDC_LOGGING)SaveUiSettings();
        return 0;}
    case WM_DEA_PROGRESS:{std::unique_ptr<Progress> p((Progress*)l);SetProgress(*p);return 0;}
    case WM_DEA_LOG:{std::unique_ptr<std::wstring>s((std::wstring*)l);AppendActivity(*s);return 0;}
    case WM_DEA_PATTERN_REVIEW:{auto*r=(PatternRequest*)l;std::set<std::wstring> kept;OpenUnusualPatternReview(r->patterns,kept);r->result=std::move(kept);r->accepted=!cancel_;return 0;}
    case WM_DEA_FINISHED:{std::unique_ptr<FinishMsg>f((FinishMsg*)l);FinishAnalyze(f->ok,f->error);return 0;}
    case WM_CTLCOLOREDIT:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_FIELD);return(LRESULT)fieldBrush_;}
    case WM_CTLCOLORSTATIC:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_BG);return(LRESULT)bgBrush_;}
    case WM_CTLCOLORBTN:{SetTextColor((HDC)w,C_TEXT);SetBkColor((HDC)w,C_BG);return(LRESULT)bgBrush_;}
    case WM_ERASEBKGND:{RECT r;GetClientRect(hwnd_,&r);FillRect((HDC)w,&r,bgBrush_);return 1;}
    case WM_CLOSE:
        if(running_){if(MessageBoxW(hwnd_,L"Analysis is still running. Cancel it and close?",APP_NAME,MB_YESNO|MB_ICONQUESTION)!=IDYES)return 0;cancel_=true;}
        SaveUiSettings();DestroyWindow(hwnd_);return 0;
    case WM_DESTROY:
        if(font_)DeleteObject(font_);if(fontBold_)DeleteObject(fontBold_);if(fontMajor_)DeleteObject(fontMajor_);if(fontMono_)DeleteObject(fontMono_);
        if(bgBrush_)DeleteObject(bgBrush_);if(panelBrush_)DeleteObject(panelBrush_);if(fieldBrush_)DeleteObject(fieldBrush_);
        PostQuitMessage(0);return 0;
    }
    return DefWindowProcW(hwnd_,m,w,l);
}

void MainWindow::ApplyDarkMode(HWND h){DarkTitle(h);}
void MainWindow::SetFonts(HWND h){SendMessage(h,WM_SETFONT,(WPARAM)font_,TRUE);}

} // namespace dea
