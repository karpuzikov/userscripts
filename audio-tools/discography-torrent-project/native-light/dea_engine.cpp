#include "dea_native.hpp"

#include <bcrypt.h>
#include <cwctype>
#include <deque>
#include <bit>
#include <limits>
#include <climits>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "bcrypt.lib")

namespace dea {
namespace {

constexpr wchar_t FFMPEG_URL[] = L"https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
constexpr wchar_t CHROMAPRINT_URL[] = L"https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-windows-x86_64.zip";

constexpr double FP_AUTO_SCORE = 5.0;
constexpr double FP_AUTO_GOOD = 0.90;
constexpr double FP_AUTO_EXCELLENT = 0.70;
constexpr double FP_AUTO_MEDIAN = 4.0;
constexpr int FP_AUTO_P90 = 10;
constexpr double FP_MIN_OVERLAP = 0.85;
constexpr double FP_MASTERING_SCORE = 7.5;
constexpr double FP_MASTERING_GOOD = 0.80;
constexpr double FP_MASTERING_MEDIAN = 7.0;
constexpr int FP_MASTERING_P90 = 14;
constexpr double FP_MASTERING_OVERLAP = 0.92;
constexpr int CD_LOG_GOOD = 80;

const std::set<std::wstring> AUDIO_EXTS{
    L".m4a",L".flac",L".wav",L".ape",L".wv",L".mp3",L".aac",L".ogg",L".opus"
};

std::wstring Trim(std::wstring v) {
    auto ws=[](wchar_t c){return std::iswspace(c)!=0;};
    while(!v.empty() && ws(v.front())) v.erase(v.begin());
    while(!v.empty() && ws(v.back())) v.pop_back();
    return v;
}

std::wstring Lower(std::wstring v) {
    std::transform(v.begin(),v.end(),v.begin(),[](wchar_t c){return (wchar_t)std::towlower(c);});
    return v;
}

bool IContains(const std::wstring& hay,const std::wstring& needle) {
    return Lower(hay).find(Lower(needle))!=std::wstring::npos;
}

bool EndsWithI(const std::wstring& s,const std::wstring& suffix) {
    if(s.size()<suffix.size()) return false;
    return Lower(s.substr(s.size()-suffix.size()))==Lower(suffix);
}

std::wstring ReplaceAll(std::wstring s,const std::wstring& a,const std::wstring& b) {
    size_t p=0;
    while((p=s.find(a,p))!=std::wstring::npos){s.replace(p,a.size(),b);p+=b.size();}
    return s;
}

std::wstring Quote(const std::wstring& arg) {
    if(arg.empty()) return L"\"\"";
    if(arg.find_first_of(L" \t\"")==std::wstring::npos) return arg;
    std::wstring out=L"\"";
    unsigned slashes=0;
    for(wchar_t c:arg){
        if(c==L'\\'){++slashes;continue;}
        if(c==L'"'){
            out.append(slashes*2+1,L'\\');
            out.push_back(L'"');
            slashes=0;
        }else{
            out.append(slashes,L'\\');slashes=0;out.push_back(c);
        }
    }
    out.append(slashes*2,L'\\');
    out.push_back(L'"');
    return out;
}

std::wstring JoinCommand(const std::vector<std::wstring>& args) {
    std::wstring cmd;
    for(size_t i=0;i<args.size();++i){if(i)cmd+=L" ";cmd+=Quote(args[i]);}
    return cmd;
}

struct ProcResult { DWORD code{0}; std::wstring out; };

ProcResult RunCapture(const std::vector<std::wstring>& args,DWORD timeoutMs=INFINITE) {
    SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};
    HANDLE readPipe=nullptr,writePipe=nullptr;
    if(!CreatePipe(&readPipe,&writePipe,&sa,0)) return {GetLastError(),L""};
    SetHandleInformation(readPipe,HANDLE_FLAG_INHERIT,0);

    STARTUPINFOW si{sizeof(si)};
    si.dwFlags=STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW;
    si.wShowWindow=SW_HIDE;
    si.hStdOutput=writePipe; si.hStdError=writePipe;
    PROCESS_INFORMATION pi{};
    std::wstring cmd=JoinCommand(args);
    std::vector<wchar_t> buf(cmd.begin(),cmd.end());buf.push_back(0);
    BOOL ok=CreateProcessW(nullptr,buf.data(),nullptr,nullptr,TRUE,
        CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT,nullptr,nullptr,&si,&pi);
    CloseHandle(writePipe);
    if(!ok){CloseHandle(readPipe);return {GetLastError(),L""};}

    std::string bytes;
    std::thread reader([&]{
        char b[8192];DWORD got=0;
        while(ReadFile(readPipe,b,sizeof(b),&got,nullptr)&&got) bytes.append(b,b+got);
    });
    DWORD wait=WaitForSingleObject(pi.hProcess,timeoutMs);
    if(wait==WAIT_TIMEOUT){TerminateProcess(pi.hProcess,1);WaitForSingleObject(pi.hProcess,5000);}
    DWORD code=1;GetExitCodeProcess(pi.hProcess,&code);
    CloseHandle(pi.hThread);CloseHandle(pi.hProcess);
    reader.join();CloseHandle(readPipe);
    return {code,Utf8ToWide(bytes)};
}

bool RunDetachedHidden(const std::vector<std::wstring>& args) {
    STARTUPINFOW si{sizeof(si)};si.dwFlags=STARTF_USESHOWWINDOW;si.wShowWindow=SW_HIDE;
    PROCESS_INFORMATION pi{};
    std::wstring cmd=JoinCommand(args);
    std::vector<wchar_t> b(cmd.begin(),cmd.end());b.push_back(0);
    BOOL ok=CreateProcessW(nullptr,b.data(),nullptr,nullptr,FALSE,
        CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT,nullptr,nullptr,&si,&pi);
    if(ok){WaitForSingleObject(pi.hProcess,INFINITE);DWORD ec=1;GetExitCodeProcess(pi.hProcess,&ec);
        CloseHandle(pi.hThread);CloseHandle(pi.hProcess);return ec==0;}
    return false;
}

std::optional<fs::path> FindExeUnder(const fs::path& root,const std::wstring& name) {
    std::error_code ec;
    if(!fs::exists(root,ec)) return std::nullopt;
    for(fs::recursive_directory_iterator it(root,fs::directory_options::skip_permission_denied,ec),end;it!=end;it.increment(ec)){
        if(ec){ec.clear();continue;}
        if(it->is_regular_file(ec) && Lower(it->path().filename().wstring())==Lower(name)) return it->path();
    }
    return std::nullopt;
}

std::optional<fs::path> FindOnPath(const std::wstring& exe) {
    wchar_t buf[32768]{};
    DWORD n=SearchPathW(nullptr,exe.c_str(),nullptr,(DWORD)std::size(buf),buf,nullptr);
    if(n>0 && n<std::size(buf)) return fs::path(buf);
    return std::nullopt;
}

std::optional<fs::path> FindWinGetPortable(const std::wstring& exe) {
    wchar_t* raw=nullptr;
    size_t len=0;
    fs::path local;
    if(_wdupenv_s(&raw,&len,L"LOCALAPPDATA")==0 && raw){
        local=raw;
        free(raw);
    }
    if(local.empty()) return std::nullopt;

    fs::path link=local/L"Microsoft"/L"WinGet"/L"Links"/exe;
    std::error_code ec;
    if(fs::exists(link,ec)) return link;

    fs::path packages=local/L"Microsoft"/L"WinGet"/L"Packages";
    return FindExeUnder(packages,exe);
}

std::optional<fs::path> FindDependencyExe(const fs::path& appLocalRoot,const std::wstring& exe) {
    if(auto p=FindOnPath(exe);p) return p;
    if(auto p=FindWinGetPortable(exe);p) return p;
    return FindExeUnder(appLocalRoot,exe);
}

bool DownloadWinHttp(const std::wstring& url,const fs::path& dest,std::function<void(uint64_t,uint64_t)> cb,std::wstring& error) {
    URL_COMPONENTS uc{sizeof(uc)};
    wchar_t host[512]{},path[4096]{};
    uc.lpszHostName=host;uc.dwHostNameLength=(DWORD)std::size(host);
    uc.lpszUrlPath=path;uc.dwUrlPathLength=(DWORD)std::size(path);
    if(!WinHttpCrackUrl(url.c_str(),0,0,&uc)){error=L"Invalid dependency URL.";return false;}
    HINTERNET ses=WinHttpOpen(L"DEA-Native/0.1",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                              WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0);
    if(!ses){error=L"WinHTTP initialization failed.";return false;}
    HINTERNET con=WinHttpConnect(ses,std::wstring(host,uc.dwHostNameLength).c_str(),uc.nPort,0);
    if(!con){WinHttpCloseHandle(ses);error=L"Dependency connection failed.";return false;}
    DWORD flags=(uc.nScheme==INTERNET_SCHEME_HTTPS)?WINHTTP_FLAG_SECURE:0;
    HINTERNET req=WinHttpOpenRequest(con,L"GET",std::wstring(path,uc.dwUrlPathLength).c_str(),
                                    nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,flags);
    bool ok=false;
    if(req && WinHttpSendRequest(req,WINHTTP_NO_ADDITIONAL_HEADERS,0,WINHTTP_NO_REQUEST_DATA,0,0,0)
       && WinHttpReceiveResponse(req,nullptr)){
        DWORD status=0,sz=sizeof(status);
        WinHttpQueryHeaders(req,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX,&status,&sz,WINHTTP_NO_HEADER_INDEX);
        if(status>=200 && status<300){
            uint64_t total=0;
            wchar_t lenBuf[64]{};DWORD lenSz=sizeof(lenBuf);
            if(WinHttpQueryHeaders(req,WINHTTP_QUERY_CONTENT_LENGTH,WINHTTP_HEADER_NAME_BY_INDEX,
                                   lenBuf,&lenSz,WINHTTP_NO_HEADER_INDEX)) total=_wcstoui64(lenBuf,nullptr,10);
            fs::create_directories(dest.parent_path());
            std::ofstream out(dest,std::ios::binary|std::ios::trunc);
            uint64_t done=0;
            while(out){
                DWORD avail=0;if(!WinHttpQueryDataAvailable(req,&avail)||avail==0)break;
                std::vector<char> data(avail);DWORD got=0;
                if(!WinHttpReadData(req,data.data(),avail,&got))break;
                out.write(data.data(),got);done+=got;if(cb)cb(done,total);
            }
            out.close();ok=fs::exists(dest)&&fs::file_size(dest)>0;
        }else error=L"Dependency download returned HTTP "+std::to_wstring(status)+L".";
    }
    if(!ok && error.empty()) error=L"Dependency download failed.";
    if(req)WinHttpCloseHandle(req);WinHttpCloseHandle(con);WinHttpCloseHandle(ses);
    return ok;
}

bool ExpandZip(const fs::path& zip,const fs::path& dest,std::wstring& error) {
    fs::create_directories(dest);
    std::wstring script=L"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath "+Quote(zip.wstring())+
                        L" -DestinationPath "+Quote(dest.wstring())+L" -Force";
    auto r=RunCapture({L"powershell.exe",L"-NoProfile",L"-ExecutionPolicy",L"Bypass",L"-Command",script},180000);
    if(r.code!=0){error=L"Could not extract dependency archive:\n"+r.out;return false;}
    return true;
}

bool IsAudio(const fs::path& p){return AUDIO_EXTS.count(Lower(p.extension().wstring()))>0;}

std::wstring StripTrackNumber(std::wstring s) {
    s=Trim(s);
    s=std::regex_replace(s,std::wregex(LR"(^\s*(?:\d{1,3}[\s._-]+|(?:cd|disc)\s*\d+\s*[-._ ]\s*))",std::regex::icase),L"");
    return Trim(s);
}

std::set<std::wstring> FeaturedArtists(const std::wstring& text) {
    std::set<std::wstring> out;
    std::wregex re(LR"((?:\bfeat(?:uring)?\.?|\bft\.?)\s+([^\(\)\[\],;]+))",std::regex::icase);
    for(auto it=std::wsregex_iterator(text.begin(),text.end(),re),e=std::wsregex_iterator();it!=e;++it){
        std::wstring names=(*it)[1].str();
        names=std::regex_replace(names,std::wregex(LR"(\s+(?:&|and|x)\s+)",std::regex::icase),L",");
        std::wstringstream ss(names);std::wstring n;
        while(std::getline(ss,n,L',')){n=Engine::Normalize(n);if(!n.empty())out.insert(n);}
    }
    return out;
}

std::wstring PrimaryArtist(const Track& t) {
    std::wstring a=t.artist;
    a=std::regex_replace(a,std::wregex(LR"(\s+(?:feat(?:uring)?\.?|ft\.?).*$)",std::regex::icase),L"");
    return Engine::Normalize(a);
}

std::wstring DescriptorInside(const std::wstring& title) {
    std::wregex re(LR"([\(\[]([^\)\]]+)[\)\]])");
    std::wstring last;
    for(auto i=std::wsregex_iterator(title.begin(),title.end(),re),e=std::wsregex_iterator();i!=e;++i)last=Trim((*i)[1].str());
    return last;
}

bool DiscFolder(const fs::path& p) {
    std::wstring n=Lower(p.filename().wstring());
    return std::regex_match(n,std::wregex(LR"(\s*(?:cd|disc|disk)\s*[-_ ]?\d+\s*)",std::regex::icase));
}

std::wstring ReleaseFamily(std::wstring title) {
    title=StripTrackNumber(title);
    title=std::regex_replace(title,std::wregex(LR"(\s*[\(\[].*?[\)\]]\s*$)"),L"");
    title=std::regex_replace(title,std::wregex(LR"(\s*[-:]\s*(?:deluxe|limited|special|expanded|anniversary|tour|bonus|sketch\s*book).*$)",std::regex::icase),L"");
    return Engine::Normalize(title);
}

int SourceRank(const Release& r) {
    if(r.hasCue&&r.hasRipLog)return 3;
    if(IContains(r.sourceMedium,L"cd")&&!IContains(r.sourceMedium,L"web"))return 2;
    return 1;
}

int RipClass(const Release& r) {
    if(SourceRank(r)<2||r.ripScores.empty())return 0;
    int worst=*std::min_element(r.ripScores.begin(),r.ripScores.end());
    return worst>=CD_LOG_GOOD?2:1;
}

size_t WantedTrackCount(const Release& r,const std::vector<Track>& tracks) {
    size_t n=0;for(int ti:r.trackIndices)if(ti>=0&&ti<(int)tracks.size()&&!tracks[ti].excluded)++n;return n;
}

std::wstring EscapeIni(std::wstring s){s=ReplaceAll(s,L"\\",L"\\\\");s=ReplaceAll(s,L"\n",L"\\n");return s;}
std::wstring UnescapeIni(std::wstring s){
    std::wstring o;for(size_t i=0;i<s.size();++i){if(s[i]==L'\\'&&i+1<s.size()){if(s[i+1]==L'n'){o+=L'\n';++i;}else if(s[i+1]==L'\\'){o+=L'\\';++i;}else o+=s[i];}else o+=s[i];}return o;
}

struct CueEntry { int no{}; fs::path file; double start{}; double end{}; std::wstring title; std::wstring performer; };
double CueTime(const std::wstring& s){
    int m=0,sec=0,frame=0;if(swscanf_s(s.c_str(),L"%d:%d:%d",&m,&sec,&frame)==3)return m*60.0+sec+frame/75.0;return 0;
}
std::vector<CueEntry> ParseCue(const fs::path& cue) {
    std::vector<CueEntry> entries;
    std::wifstream in(cue); if(!in)return entries;
    std::wstring line,currentFile,currentTitle,currentPerf; CueEntry* current=nullptr;
    while(std::getline(in,line)){
        line=Trim(line);
        std::wsmatch m;
        if(std::regex_match(line,m,std::wregex(LR"cue(^FILE\s+"([^"]+)".*$)cue",std::regex::icase))){currentFile=m[1].str();}
        else if(std::regex_match(line,m,std::wregex(LR"(^TRACK\s+(\d+)\s+AUDIO.*$)",std::regex::icase))){
            CueEntry e;e.no=std::stoi(m[1].str());e.file=cue.parent_path()/currentFile;entries.push_back(e);current=&entries.back();
        } else if(current&&std::regex_match(line,m,std::wregex(LR"cue(^TITLE\s+"(.*)"$)cue",std::regex::icase)))current->title=m[1].str();
        else if(current&&std::regex_match(line,m,std::wregex(LR"cue(^PERFORMER\s+"(.*)"$)cue",std::regex::icase)))current->performer=m[1].str();
        else if(current&&std::regex_match(line,m,std::wregex(LR"(^INDEX\s+01\s+(\d+:\d+:\d+).*$)",std::regex::icase)))current->start=CueTime(m[1].str());
    }
    if(entries.size()>1){
        bool oneImage=true;auto image=entries.front().file;
        for(auto& e:entries)if(Lower(e.file.wstring())!=Lower(image.wstring()))oneImage=false;
        if(oneImage)for(size_t i=0;i+1<entries.size();++i)entries[i].end=entries[i+1].start;
        else entries.clear();
    } else entries.clear();
    return entries;
}

struct DSU {
    std::vector<int> p,r;
    explicit DSU(int n):p(n),r(n,0){std::iota(p.begin(),p.end(),0);}
    int find(int a){return p[a]==a?a:p[a]=find(p[a]);}
    void unite(int a,int b){a=find(a);b=find(b);if(a==b)return;if(r[a]<r[b])std::swap(a,b);p[b]=a;if(r[a]==r[b])++r[a];}
};

uint64_t HashWords(const std::vector<uint64_t>& words){
    uint64_t h=1469598103934665603ULL;
    for(auto v:words){h^=v;h*=1099511628211ULL;}return h;
}

bool SegmentSilence(const std::vector<uint32_t>& s,size_t begin,size_t end) {
    if(end<=begin||end-begin<120)return true;
    std::unordered_map<uint32_t,int> counts;counts.reserve(end-begin);
    int best=0;for(size_t i=begin;i<end;++i){best=std::max(best,++counts[s[i]]);}
    double dominant=(double)best/(end-begin);
    double unique=(double)counts.size()/(end-begin);
    return dominant>=0.90||unique<=0.03;
}

bool UnmatchedSilence(const std::vector<uint32_t>& a,const std::vector<uint32_t>& b,int shift) {
    size_t a0=shift>0?(size_t)shift:0,b0=shift<0?(size_t)-shift:0;
    size_t n=std::min(a.size()-std::min(a0,a.size()),b.size()-std::min(b0,b.size()));
    return SegmentSilence(a,0,a0)&&SegmentSilence(b,0,b0)&&
           SegmentSilence(a,std::min(a0+n,a.size()),a.size())&&
           SegmentSilence(b,std::min(b0+n,b.size()),b.size());
}

std::vector<int> TrackProviders(const std::vector<Release>& releases,int gid) {
    std::vector<int> out;for(auto& r:releases)if(!r.blocked&&r.groups.count(gid))out.push_back(r.id);return out;
}

std::wstring Timestamp(){
    SYSTEMTIME st{};GetLocalTime(&st);wchar_t b[64]{};
    swprintf_s(b,L"%04d-%02d-%02d-%02d-%02d-%02d",st.wYear,st.wMonth,st.wDay,st.wHour,st.wMinute,st.wSecond);
    return b;
}

} // namespace

std::wstring Utf8ToWide(const std::string& s){
    if(s.empty())return {};
    int n=MultiByteToWideChar(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0);
    std::wstring w(n,0);MultiByteToWideChar(CP_UTF8,0,s.data(),(int)s.size(),w.data(),n);return w;
}
std::string WideToUtf8(const std::wstring& s){
    if(s.empty())return {};
    int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);
    std::string b(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),b.data(),n,nullptr,nullptr);return b;
}
std::wstring ReadTextFileUtf8(const fs::path& p){std::ifstream in(p,std::ios::binary);std::ostringstream ss;ss<<in.rdbuf();return Utf8ToWide(ss.str());}
bool WriteTextFileUtf8(const fs::path& p,const std::wstring& t){fs::create_directories(p.parent_path());std::ofstream o(p,std::ios::binary|std::ios::trunc);auto b=WideToUtf8(t);o.write(b.data(),b.size());return !!o;}

AppPaths ResolveAppPaths(){
    PWSTR raw=nullptr;fs::path docs;
    if(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents,0,nullptr,&raw))&&raw){docs=raw;CoTaskMemFree(raw);}
    if(docs.empty())docs=fs::path(_wgetenv(L"USERPROFILE")?_wgetenv(L"USERPROFILE"):L".")/L"Documents";
    AppPaths p; p.root=docs/L"Karpuzikov Tools"/PROGRAM_DIR_NAME;
    p.dependencies=p.root/L"dependencies";p.logs=p.root/L"logs";p.temp=p.root/L"temp";p.cache=p.root/L"cache";p.state=p.root/L"state";
    p.settings=p.root/L"settings.ini";p.undoManifest=p.state/L"undo-last-run.tsv";
    std::error_code ec;for(auto d:{p.root,p.dependencies,p.logs,p.temp,p.cache,p.state})fs::create_directories(d,ec);
    return p;
}

bool OpenPathLocation(const fs::path& p,std::wstring& error){
    std::error_code ec;if(!fs::exists(p,ec)){error=L"Path no longer exists:\n\n"+p.wstring();return false;}
    if(fs::is_regular_file(p,ec)){
        std::wstring arg=L"/select,\""+p.wstring()+L"\"";
        HINSTANCE r=ShellExecuteW(nullptr,L"open",L"explorer.exe",arg.c_str(),nullptr,SW_SHOWNORMAL);
        if((INT_PTR)r<=32){error=L"Explorer could not select:\n\n"+p.wstring();return false;}
    }else{
        HINSTANCE r=ShellExecuteW(nullptr,L"open",p.c_str(),nullptr,nullptr,SW_SHOWNORMAL);
        if((INT_PTR)r<=32){error=L"Explorer could not open:\n\n"+p.wstring();return false;}
    }
    return true;
}

Engine::Engine():paths_(ResolveAppPaths()){}

Settings Engine::LoadSettings() const{
    Settings s;if(!fs::exists(paths_.settings))return s;
    std::wifstream in(paths_.settings);std::wstring line;
    while(std::getline(in,line)){
        auto p=line.find(L'=');if(p==std::wstring::npos)continue;
        auto k=Trim(line.substr(0,p)),v=UnescapeIni(line.substr(p+1));
        if(k==L"existing")s.existing=v;else if(k==L"incoming")s.incoming=v;
        else if(k==L"saveRemixes")s.saveRemixes=v==L"1";else if(k==L"saveLive")s.saveLive=v==L"1";
        else if(k==L"logging")s.logging=v==L"1";
        else if(k==L"pick"){
            auto a=v.find(L'|'),b=a==std::wstring::npos?a:v.find(L'|',a+1);
            if(a!=std::wstring::npos){
                PersonalPick x;auto mode=v.substr(0,a);x.value=b==std::wstring::npos?v.substr(a+1):v.substr(a+1,b-a-1);
                if(mode==L"exact")x.mode=PersonalPick::Mode::Exact;else if(mode==L"pattern")x.mode=PersonalPick::Mode::Pattern;
                if(b!=std::wstring::npos)x.key=v.substr(b+1);s.personalPicks.push_back(x);
            }
        }
    }return s;
}
bool Engine::SaveSettings(const Settings& s) const{
    fs::create_directories(paths_.root);std::wofstream o(paths_.settings,std::ios::trunc);if(!o)return false;
    o<<L"existing="<<EscapeIni(s.existing.wstring())<<L"\n";
    o<<L"incoming="<<EscapeIni(s.incoming.wstring())<<L"\n";
    o<<L"saveRemixes="<<(s.saveRemixes?1:0)<<L"\n";
    o<<L"saveLive="<<(s.saveLive?1:0)<<L"\n";
    o<<L"logging="<<(s.logging?1:0)<<L"\n";
    for(auto& p:s.personalPicks){std::wstring m=p.mode==PersonalPick::Mode::Exact?L"exact":p.mode==PersonalPick::Mode::Pattern?L"pattern":L"contains";
        o<<L"pick="<<m<<L"|"<<EscapeIni(p.value)<<L"|"<<EscapeIni(p.key)<<L"\n";}
    return true;
}

bool Engine::EnsureDependencies(ProgressFn progress,LogFn log,std::wstring& error){
    auto emit=[&](const std::wstring& s,uint64_t c=0,uint64_t t=0){
        if(progress)progress({s,c,t,0,std::chrono::steady_clock::now()});
        if(log)log(s);
    };
    emit(L"Checking dependencies");

    // Global dependency policy: WinGet is the primary install/update channel.
    auto winget=FindOnPath(L"winget.exe");
    if(!winget){
        emit(L"WinGet not found - repairing Windows Package Manager");
        std::wstring ps=L"$ErrorActionPreference='SilentlyContinue';"
                         L"Install-PackageProvider -Name NuGet -Force | Out-Null;"
                         L"Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery | Out-Null;"
                         L"Import-Module Microsoft.WinGet.Client;Repair-WinGetPackageManager -Force -Latest";
        RunCapture({L"powershell.exe",L"-NoProfile",L"-ExecutionPolicy",L"Bypass",L"-Command",ps},180000);
        winget=FindOnPath(L"winget.exe");
    }

    auto wingetCommon=[&](){
        return std::vector<std::wstring>{
            L"--silent",L"--accept-package-agreements",L"--accept-source-agreements",L"--disable-interactivity"
        };
    };
    auto appendArgs=[](std::vector<std::wstring> a,const std::vector<std::wstring>& b){
        a.insert(a.end(),b.begin(),b.end());
        return a;
    };

    // FFmpeg has a maintained WinGet package. Check/update it first on every run.
    if(winget){
        emit(L"Checking FFmpeg updates via WinGet");
        auto listed=RunCapture({winget->wstring(),L"list",L"--id",L"Gyan.FFmpeg",L"-e",L"--source",L"winget",
                                L"--accept-source-agreements",L"--disable-interactivity"},60000);
        bool installed=Lower(listed.out).find(L"gyan.ffmpeg")!=std::wstring::npos;
        if(installed){
            auto args=appendArgs({winget->wstring(),L"upgrade",L"--id",L"Gyan.FFmpeg",L"-e",L"--source",L"winget"},wingetCommon());
            auto upgraded=RunCapture(args,180000);
            if(log){
                if(upgraded.code==0) log(L"FFmpeg WinGet check complete.");
                else log(L"FFmpeg WinGet upgrade check returned no applicable update or could not update; existing install will be verified.");
            }
        }else{
            emit(L"Installing FFmpeg via WinGet");
            auto args=appendArgs({winget->wstring(),L"install",L"--id",L"Gyan.FFmpeg",L"-e",L"--source",L"winget"},wingetCommon());
            auto installedResult=RunCapture(args,300000);
            if(installedResult.code!=0 && log)
                log(L"WinGet could not install FFmpeg; app-local fallback will be used.");
        }
    }

    auto ff=FindDependencyExe(paths_.dependencies/L"FFmpeg",L"ffmpeg.exe");
    auto probe=FindDependencyExe(paths_.dependencies/L"FFmpeg",L"ffprobe.exe");
    if(ff&&probe){ffmpeg_=*ff;ffprobe_=*probe;}

    // Fallback exists only for systems where WinGet/package installation is unavailable.
    if(ffmpeg_.empty()||ffprobe_.empty()){
        emit(L"WinGet FFmpeg unavailable - using app-local fallback");
        fs::path zip=paths_.temp/L"ffmpeg.zip",dest=paths_.dependencies/L"FFmpeg";
        std::error_code ec;fs::remove_all(dest,ec);
        if(!DownloadWinHttp(FFMPEG_URL,zip,[&](uint64_t d,uint64_t t){
            if(progress)progress({L"Downloading FFmpeg fallback",d,t,0,std::chrono::steady_clock::now()});
        },error))return false;
        if(!ExpandZip(zip,dest,error))return false;fs::remove(zip,ec);
        ff=FindExeUnder(dest,L"ffmpeg.exe");probe=FindExeUnder(dest,L"ffprobe.exe");
        if(!ff||!probe){error=L"FFmpeg fallback archive did not contain ffmpeg.exe and ffprobe.exe.";return false;}
        ffmpeg_=*ff;ffprobe_=*probe;
    }

    // Prefer WinGet for Chromaprint too whenever a package is available. At
    // present the public WinGet source may not expose an unambiguous package,
    // so failure here intentionally falls back to the app-local official build.
    auto fp=FindDependencyExe(paths_.dependencies/L"Chromaprint",L"fpcalc.exe");
    if(!fp && winget){
        emit(L"Checking Chromaprint via WinGet");
        auto args=appendArgs({winget->wstring(),L"install",L"--query",L"Chromaprint",L"--source",L"winget"},wingetCommon());
        auto installedFp=RunCapture(args,180000);
        if(installedFp.code!=0){
            args=appendArgs({winget->wstring(),L"install",L"--query",L"fpcalc",L"--source",L"winget"},wingetCommon());
            installedFp=RunCapture(args,180000);
        }
        fp=FindDependencyExe(paths_.dependencies/L"Chromaprint",L"fpcalc.exe");
        if(!fp && log)log(L"No usable Chromaprint WinGet package was found; app-local fallback will be used.");
    }
    if(fp)fpcalc_=*fp;

    if(fpcalc_.empty()){
        emit(L"Installing app-local Chromaprint fallback");
        fs::path zip=paths_.temp/L"chromaprint.zip",dest=paths_.dependencies/L"Chromaprint";
        std::error_code ec;fs::remove_all(dest,ec);
        if(!DownloadWinHttp(CHROMAPRINT_URL,zip,[&](uint64_t d,uint64_t t){
            if(progress)progress({L"Downloading Chromaprint fallback",d,t,0,std::chrono::steady_clock::now()});
        },error))return false;
        if(!ExpandZip(zip,dest,error))return false;fs::remove(zip,ec);
        fp=FindExeUnder(dest,L"fpcalc.exe");
        if(!fp){error=L"Chromaprint fallback archive did not contain fpcalc.exe.";return false;}
        fpcalc_=*fp;
    }

    for(auto [exe,label]:std::vector<std::pair<fs::path,std::wstring>>{
        {ffmpeg_,L"FFmpeg"},{ffprobe_,L"FFprobe"},{fpcalc_,L"Chromaprint"}
    }){
        auto r=RunCapture({exe.wstring(),L"-version"},20000);
        if(r.code!=0){error=label+L" failed its startup check.";return false;}
    }
    emit(L"Dependencies ready");
    return true;
}

std::wstring Engine::Normalize(const std::wstring& value){
    std::wstring s=Lower(value);
    s=ReplaceAll(s,L"&",L" and ");
    for(auto& c:s)if(!(std::iswalnum(c)||c==L'$'||c==L'+'||c==L'\''||c==L' '))c=L' ';
    s=std::regex_replace(s,std::wregex(LR"(\s+)"),L" ");
    return Trim(s);
}
std::wstring Engine::BaseTitle(const std::wstring& value){
    std::wstring s=StripTrackNumber(value);
    s=std::regex_replace(s,std::wregex(LR"(\s*[\(\[][^\)\]]*(?:remix|mix|edit|version|live|unplugged|acoustic|instrumental|a\s*capella|acapella|extended|radio|dub|reverb|slowed|sped\s*up)[^\)\]]*[\)\]])",std::regex::icase),L"");
    s=std::regex_replace(s,std::wregex(LR"(\s*[-:]\s*[^\-:]*(?:remix|mix|edit|version|live|unplugged|acoustic|instrumental|a\s*capella|acapella|extended|radio|dub)\s*$)",std::regex::icase),L"");
    return Normalize(s);
}
bool Engine::IsRemixText(const std::wstring& title){
    auto s=Lower(title);
    return std::regex_search(s,std::wregex(LR"(\b(remix|rmx|dub|vip|club\s+mix|mix\s+edit|vocal\s+mix|radio\s+mix|sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?)\b)",std::regex::icase));
}
bool Engine::IsLiveText(const std::wstring& title){
    auto s=Lower(title);
    return std::regex_search(s,std::wregex(LR"(\b(live|unplugged|concert|sessions?)\b)",std::regex::icase));
}
RecordingRoot Engine::DetectRecordingRoot(const std::wstring& title){
    auto s=Lower(title);
    if(IsRemixText(s))return RecordingRoot::Remix;
    if(IsLiveText(s))return RecordingRoot::Live;
    if(std::regex_search(s,std::wregex(LR"(\binstrumental\b)",std::regex::icase)))return RecordingRoot::Instrumental;
    if(std::regex_search(s,std::wregex(LR"(\b(?:a\s*capella|acapella|acappella)\b)",std::regex::icase)))return RecordingRoot::Acapella;
    if(std::regex_search(s,std::wregex(LR"(\bacoustic\b)",std::regex::icase)))return RecordingRoot::Acoustic;
    if(std::regex_search(s,std::wregex(LR"(\bextended(?:\s+(?:version|mix))?\b)",std::regex::icase)))return RecordingRoot::Extended;
    return RecordingRoot::Base;
}
std::wstring Engine::RecordingRootKey(const std::wstring& title){
    std::wstring base=BaseTitle(title),desc=Lower(DescriptorInside(title));
    auto root=DetectRecordingRoot(title);
    if(root==RecordingRoot::Base)return base;
    // Radio/Edit suffixes are replaceable within their already-established parent root.
    desc=std::regex_replace(desc,std::wregex(LR"(\b(?:radio|single|album|main)\s+(?:edit|version)\b|\bedit\b)",std::regex::icase),L" ");
    if(root!=RecordingRoot::Extended)
        desc=std::regex_replace(desc,std::wregex(LR"(\bextended(?:\s+(?:mix|version))?\b)",std::regex::icase),L" ");
    desc=Normalize(desc);
    const wchar_t* r=root==RecordingRoot::Remix?L"remix":root==RecordingRoot::Live?L"live":
        root==RecordingRoot::Instrumental?L"instrumental":root==RecordingRoot::Acapella?L"acapella":
        root==RecordingRoot::Acoustic?L"acoustic":L"extended";
    if(desc.empty())desc=r;
    return base+L"|"+r+L"|"+desc;
}
bool Engine::SemanticConflict(const Track& a,const Track& b){
    if(a.fingerprint==b.fingerprint && !a.fingerprint.empty())return false;
    if(a.rootKey.empty()||b.rootKey.empty())return false;
    return a.rootKey!=b.rootKey && (a.root!=RecordingRoot::Base||b.root!=RecordingRoot::Base);
}
bool Engine::IsKnownDescriptor(const std::wstring& d){
    auto s=Lower(d);
    if(s.empty())return true;
    static const std::wregex known(LR"(\b(remix|rmx|mix|dub|vip|radio|edit|version|extended|live|unplugged|acoustic|instrumental|a\s*capella|acapella|sped\s*up|speed\s*up|slowed|reverb|clean|explicit|album|single|main|original)\b)",std::regex::icase);
    return std::regex_search(s,known);
}
std::wstring Engine::DetectUnusualPattern(const std::wstring& title){
    std::wregex bracket(LR"([\(\[]([^\)\]]+)[\)\]])");
    for(auto i=std::wsregex_iterator(title.begin(),title.end(),bracket),e=std::wsregex_iterator();i!=e;++i){
        auto d=Trim((*i)[1].str()),n=Normalize(d);
        if(IsKnownDescriptor(d))continue;
        if(std::regex_search(n,std::wregex(LR"(\b(callout|call\s+out|hook|performance|take|promo|broadcast|special|alternate|alternative)\b)",std::regex::icase)))return n;
    }
    std::wsmatch m;
    if(std::regex_search(title,m,std::wregex(LR"(\s[-:]\s([^-:]+)$)"))){
        auto d=Trim(m[1].str()),n=Normalize(d);
        if(!IsKnownDescriptor(d)&&std::regex_search(n,std::wregex(LR"(\b(callout|hook|performance|take|promo|broadcast|alternate|alternative)\b)",std::regex::icase)))return n;
    }
    return {};
}

std::optional<FingerprintSimilarity> Engine::CompareFingerprints(const std::vector<uint32_t>& a,const std::vector<uint32_t>& b){
    if(std::min(a.size(),b.size())<20)return std::nullopt;
    std::unordered_map<int,std::vector<int>> p12,p10;
    for(int i=0;i<(int)a.size();++i){p12[(a[i]>>20)&0xfff].push_back(i);p10[(a[i]>>22)&0x3ff].push_back(i);}
    std::unordered_map<int,int> hist;
    for(int j=0;j<(int)b.size();++j){
        auto i12=p12.find((b[j]>>20)&0xfff);if(i12!=p12.end())for(int i:i12->second)hist[i-j]+=4;
        auto i10=p10.find((b[j]>>22)&0x3ff);if(i10!=p10.end())for(int i:i10->second)hist[i-j]+=1;
    }
    std::vector<std::pair<int,int>> hv(hist.begin(),hist.end());
    std::partial_sort(hv.begin(),hv.begin()+std::min<size_t>(24,hv.size()),hv.end(),[](auto&x,auto&y){return x.second>y.second;});
    std::vector<int> shifts{0,-1,1,-2,2,-3,3,-4,4,-5,5,-6,6};
    std::set<int> seen(shifts.begin(),shifts.end());
    for(size_t i=0;i<std::min<size_t>(24,hv.size());++i)if(seen.insert(hv[i].first).second)shifts.push_back(hv[i].first);
    std::optional<FingerprintSimilarity> best;
    for(int sh:shifts){
        size_t a0=sh>0?(size_t)sh:0,b0=sh<0?(size_t)-sh:0;
        if(a0>=a.size()||b0>=b.size())continue;
        size_t n=std::min(a.size()-a0,b.size()-b0);if(n<20)continue;
        std::vector<int>d;d.reserve(n);double sum=0;size_t good=0,excellent=0;
        for(size_t k=0;k<n;++k){int x=std::popcount(a[a0+k]^b[b0+k]);d.push_back(x);sum+=x;if(x<=10)++good;if(x<=5)++excellent;}
        std::sort(d.begin(),d.end());double med=n%2?d[n/2]:(d[n/2-1]+d[n/2])/2.0;int p90=d[(size_t)(0.90*(n-1))];
        FingerprintSimilarity s{sum/n,(double)good/n,(double)n/std::min(a.size(),b.size()),sh,(double)excellent/n,med,p90};
        if(!best ||
           std::tuple<double,double,double,double>{s.score,-s.good,-s.excellent,-s.overlap}
             < std::tuple<double,double,double,double>{best->score,-best->good,-best->excellent,-best->overlap})
            best=s;
    }
    return best;
}
bool Engine::FingerprintsMatch(const std::vector<uint32_t>& a,const std::vector<uint32_t>& b,FingerprintSimilarity* out){
    auto s=CompareFingerprints(a,b);if(!s)return false;if(out)*out=*s;
    bool strict=s->overlap>=FP_MIN_OVERLAP&&s->score<=FP_AUTO_SCORE&&s->good>=FP_AUTO_GOOD&&s->excellent>=FP_AUTO_EXCELLENT&&s->median<=FP_AUTO_MEDIAN&&s->p90<=FP_AUTO_P90;
    bool master=s->overlap>=FP_MASTERING_OVERLAP&&s->score<=FP_MASTERING_SCORE&&s->good>=FP_MASTERING_GOOD&&s->median<=FP_MASTERING_MEDIAN&&s->p90<=FP_MASTERING_P90;
    if(!strict&&!master)return false;
    size_t a0=s->shift>0?(size_t)s->shift:0,b0=s->shift<0?(size_t)-s->shift:0;
    size_t n=(a0<a.size()&&b0<b.size())?std::min(a.size()-a0,b.size()-b0):0;
    double coverage=(double)n/std::max<size_t>(1,std::max(a.size(),b.size()));
    return coverage>=0.94||UnmatchedSilence(a,b,s->shift);
}

bool Engine::ScanRoot(const fs::path& root,RootKind kind,std::vector<Release>& releases,std::vector<Track>& tracks,
                      ProgressFn progress,LogFn log,std::atomic_bool& cancel,std::wstring& error){
    if(root.empty())return true;std::error_code ec;if(!fs::is_directory(root,ec)){error=L"Folder does not exist:\n\n"+root.wstring();return false;}
    std::map<fs::path,std::vector<fs::path>> audioByDir;std::map<fs::path,std::vector<fs::path>> cuesByDir;
    uint64_t seen=0;
    for(fs::recursive_directory_iterator it(root,fs::directory_options::skip_permission_denied,ec),end;it!=end;it.increment(ec)){
        if(cancel)return false;if(ec){ec.clear();continue;}if(!it->is_regular_file(ec))continue;
        auto p=it->path();auto ext=Lower(p.extension().wstring());
        if(AUDIO_EXTS.count(ext))audioByDir[p.parent_path()].push_back(p);else if(ext==L".cue")cuesByDir[p.parent_path()].push_back(p);
        if((++seen%500)==0&&progress)progress({L"Scanning release folders",seen,0,0,std::chrono::steady_clock::now()});
    }
    std::set<fs::path> dirs;for(auto&[d,_]:audioByDir)dirs.insert(d);for(auto&[d,_]:cuesByDir)dirs.insert(d);
    for(auto& dir:dirs){
        Release r;r.id=(int)releases.size();r.rootKind=kind;r.path=dir;r.physicalPaths={dir};r.scanRoot=root;r.title=dir.filename().wstring();
        std::set<fs::path> cueImages;
        for(auto& cue:cuesByDir[dir]){
            auto ce=ParseCue(cue);
            if(!ce.empty()){
                r.hasCue=true;cueImages.insert(ce.front().file);
                for(size_t j=0;j<ce.size();++j){
                    Track t;t.releaseId=r.id;t.index=(int)tracks.size();t.path=ce[j].file;t.virtualCue=true;t.cuePath=cue;t.cueImage=ce[j].file;t.cueTrackNo=ce[j].no;
                    t.cueStart=ce[j].start;t.cueEnd=ce[j].end;t.duration=ce[j].end>ce[j].start?ce[j].end-ce[j].start:0;
                    t.title=ce[j].title.empty()?StripTrackNumber(ce[j].file.stem().wstring()):ce[j].title;t.artist=ce[j].performer;
                    r.trackIndices.push_back(t.index);tracks.push_back(std::move(t));
                }
            }
        }
        for(auto& p:audioByDir[dir]){
            if(cueImages.count(p))continue;
            Track t;t.releaseId=r.id;t.index=(int)tracks.size();t.path=p;t.title=StripTrackNumber(p.stem().wstring());
            r.trackIndices.push_back(t.index);tracks.push_back(std::move(t));
        }
        for(auto& e:fs::directory_iterator(dir,fs::directory_options::skip_permission_denied,ec)){
            if(!e.is_regular_file(ec))continue;auto ext=Lower(e.path().extension().wstring());
            if(ext==L".log"&&!IContains(e.path().filename().wstring(),L"audiochecker")){r.hasRipLog=true;r.ripLogs.push_back(e.path());}
            if(IContains(e.path().filename().wstring(),L"audiochecker"))r.hasAudioChecker=true;
        }
        releases.push_back(std::move(r));
    }
    GroupDiscFolders(releases,tracks);
    if(log)log(L"Found "+std::to_wstring(releases.size())+L" release folder(s), "+std::to_wstring(tracks.size())+L" track(s)");
    return true;
}

void Engine::GroupDiscFolders(std::vector<Release>& releases,std::vector<Track>& tracks){
    std::map<std::tuple<RootKind,std::wstring>,std::vector<int>> buckets;
    for(auto&r:releases)if(DiscFolder(r.path))buckets[{r.rootKind,Lower(r.path.parent_path().wstring())}].push_back(r.id);
    std::set<int> merged;
    for(auto&[_,ids]:buckets){
        if(ids.size()<2)continue;int base=ids.front();auto& br=releases[base];br.path=br.path.parent_path();br.title=br.path.filename().wstring();
        for(size_t k=1;k<ids.size();++k){auto& x=releases[ids[k]];br.physicalPaths.push_back(x.path);br.trackIndices.insert(br.trackIndices.end(),x.trackIndices.begin(),x.trackIndices.end());
            br.hasCue|=x.hasCue;br.hasRipLog|=x.hasRipLog;br.ripLogs.insert(br.ripLogs.end(),x.ripLogs.begin(),x.ripLogs.end());
            for(int ti:x.trackIndices)tracks[ti].releaseId=base;merged.insert(x.id);}
    }
    if(merged.empty())return;
    std::vector<Release> nr;std::unordered_map<int,int> remap;
    for(auto&r:releases)if(!merged.count(r.id)){int old=r.id;r.id=(int)nr.size();remap[old]=r.id;nr.push_back(std::move(r));}
    for(auto&t:tracks)t.releaseId=remap[t.releaseId];
    for(auto&r:nr)for(int ti:r.trackIndices)tracks[ti].releaseId=r.id;
    releases=std::move(nr);
}

bool Engine::ProbeOne(Track& t,std::wstring& error){
    fs::path src=t.virtualCue?t.cueImage:t.path;
    auto r=RunCapture({ffprobe_.wstring(),L"-v",L"error",L"-select_streams",L"a:0",
        L"-show_entries",L"stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample:format=duration:format_tags=title,artist,album,album_artist,track,comment",
        L"-of",L"default=noprint_wrappers=1:nokey=0",src.wstring()},60000);
    if(r.code!=0){error=L"FFprobe failed: "+src.wstring()+L"\n"+r.out;return false;}
    std::wistringstream ss(r.out);std::wstring line;
    while(std::getline(ss,line)){
        auto p=line.find(L'=');if(p==std::wstring::npos)continue;auto k=Lower(Trim(line.substr(0,p))),v=Trim(line.substr(p+1));
        if(k==L"codec_name")t.codec=v;else if(k==L"sample_rate")t.sampleRate=_wtoi(v.c_str());else if(k==L"channels")t.channels=_wtoi(v.c_str());
        else if(k==L"bits_per_raw_sample"||k==L"bits_per_sample"){int b=_wtoi(v.c_str());if(b)t.bitDepth=b;}
        else if(k==L"duration"&&!t.virtualCue)t.duration=_wtof(v.c_str());
        else if(k==L"tag:title"&&!t.virtualCue&&!v.empty())t.title=v;
        else if(k==L"tag:artist"&&!t.virtualCue&&!v.empty())t.artist=v;
        else if(k==L"tag:album"&&!v.empty())t.album=v;
        else if(k==L"tag:comment"){auto lv=Lower(v);if(lv.find(L"explicit")!=std::wstring::npos)t.explicitTrack=true;if(lv.find(L"clean")!=std::wstring::npos)t.cleanTrack=true;}
    }
    std::error_code ec;t.fileSize=fs::file_size(src,ec);return true;
}
bool Engine::ProbeTracks(std::vector<Track>& tracks,ProgressFn progress,LogFn log,std::atomic_bool& cancel,std::wstring& error){
    unsigned workers=std::min(64u,std::max(8u,std::thread::hardware_concurrency()*2));std::atomic_size_t next{0},done{0};std::mutex em;std::wstring firstError;
    auto start=std::chrono::steady_clock::now();
    std::vector<std::thread> ts;
    for(unsigned w=0;w<workers;++w)ts.emplace_back([&]{
        while(true){size_t i=next.fetch_add(1);if(i>=tracks.size()||cancel)break;std::wstring e;if(!ProbeOne(tracks[i],e)){std::lock_guard l(em);if(firstError.empty())firstError=e;}
            auto d=++done;if(progress&&(d%4==0||d==tracks.size())){double sec=std::max(0.001,std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count());progress({L"Reading tags and durations ("+std::to_wstring(workers)+L" workers)",d,tracks.size(),d/sec,start});}}
    });for(auto&t:ts)t.join();if(cancel)return false;
    if(!firstError.empty()&&log)log(L"Some metadata probes failed conservatively; filenames remain usable.");
    return true;
}

void Engine::ClassifyTracks(std::vector<Release>& releases,std::vector<Track>& tracks,const AnalysisOptions& options,LogFn log){
    for(auto&t:tracks){
        std::wstring text=t.title+L" "+t.path.stem().wstring();t.isRemix=IsRemixText(text);t.isLive=IsLiveText(text);t.root=DetectRecordingRoot(text);t.baseTitle=BaseTitle(t.title);t.rootKey=RecordingRootKey(t.title);t.unusualPattern=DetectUnusualPattern(t.title);
    }
    std::map<std::pair<std::wstring,std::wstring>,std::set<std::wstring>> ordinaryFeatures;
    std::set<std::pair<std::wstring,std::wstring>> bases;
    for(auto&t:tracks)if(!t.isRemix&&!t.isLive){auto key=std::make_pair(t.baseTitle,PrimaryArtist(t));bases.insert(key);auto f=FeaturedArtists(t.title+L" "+t.artist);ordinaryFeatures[key].insert(f.begin(),f.end());}
    for(auto&t:tracks){
        auto key=std::make_pair(t.baseTitle,PrimaryArtist(t));auto features=FeaturedArtists(t.title+L" "+t.artist);std::set<std::wstring> added;
        if(bases.count(key))std::set_difference(features.begin(),features.end(),ordinaryFeatures[key].begin(),ordinaryFeatures[key].end(),std::inserter(added,added.begin()));
        else if(t.isRemix){auto desc=DescriptorInside(t.title);added=FeaturedArtists(desc);}
        t.remixFeatureException=t.isRemix&&!added.empty();
        bool remixOff=!options.saveRemixes&&t.isRemix&&!t.remixFeatureException;
        bool liveOff=!options.saveLive&&t.isLive;
        t.excluded=remixOff||liveOff;

        bool picked=false;
        const std::wstring normTitle=Normalize(t.title);
        for(const auto& pick:options.personalPicks){
            if(pick.mode==PersonalPick::Mode::Pattern)continue;
            const auto needle=Normalize(pick.value);
            if(needle.empty())continue;
            if(pick.mode==PersonalPick::Mode::Exact ? normTitle==needle : normTitle.find(needle)!=std::wstring::npos){
                picked=true;break;
            }
        }
        // Personal Picks never resurrect a globally disabled Remix/Live category.
        if(!t.unusualPattern.empty()&&!options.keptPatterns.count(t.unusualPattern)&&!picked)
            t.excluded=true;
    }
    ApplyExplicitCleanPolicy(tracks);
    size_t ex=0;for(auto&t:tracks)if(t.excluded)++ex;if(log)log(L"Early exclusions: "+std::to_wstring(ex)+L" track(s)");
}

void Engine::ApplyExplicitCleanPolicy(std::vector<Track>& tracks){
    std::map<std::pair<std::wstring,std::wstring>,std::vector<int>> by;
    for(int i=0;i<(int)tracks.size();++i)by[{tracks[i].baseTitle,PrimaryArtist(tracks[i])}].push_back(i);
    for(auto&[_,ids]:by){bool explicitFound=false;for(int i:ids)explicitFound|=tracks[i].explicitTrack;if(explicitFound)for(int i:ids)if(tracks[i].cleanTrack)tracks[i].excluded=true;}
}

bool Engine::FingerprintOne(Track& t,std::wstring& error){
    fs::path src=t.path,tmp;
    if(t.virtualCue){
        tmp=paths_.temp/(L"cue-"+std::to_wstring((uint64_t)std::hash<std::wstring>{}(t.cuePath.wstring()+std::to_wstring(t.cueTrackNo)))+L".wav");
        std::vector<std::wstring> cmd{ffmpeg_.wstring(),L"-hide_banner",L"-loglevel",L"error",L"-y"};
        if(t.cueStart>0){cmd.push_back(L"-ss");cmd.push_back(std::to_wstring(t.cueStart));}
        cmd.insert(cmd.end(),{L"-i",t.cueImage.wstring()});
        if(t.duration>0){cmd.push_back(L"-t");cmd.push_back(std::to_wstring(t.duration));}
        cmd.insert(cmd.end(),{L"-vn",L"-acodec",L"pcm_s16le",tmp.wstring()});
        auto r=RunCapture(cmd,300000);if(r.code!=0){error=L"CUE extraction failed:\n"+r.out;return false;}src=tmp;
    }
    auto r=RunCapture({fpcalc_.wstring(),L"-length",L"0",L"-raw",src.wstring()},300000);
    if(!tmp.empty()){std::error_code ec;fs::remove(tmp,ec);}
    if(r.code!=0&&r.code!=3){error=L"Chromaprint failed:\n"+r.out;return false;}
    std::wistringstream ss(r.out);std::wstring line;
    while(std::getline(ss,line)){
        if(line.rfind(L"DURATION=",0)==0)t.fingerprintDuration=_wtof(line.substr(9).c_str());
        else if(line.rfind(L"FINGERPRINT=",0)==0){
            std::wstringstream fsx(line.substr(12));std::wstring v;while(std::getline(fsx,v,L',')){uint64_t x=_wcstoui64(v.c_str(),nullptr,10);t.fingerprint.push_back((uint32_t)x);}
        }
    }
    if(t.fingerprint.empty()){error=L"Chromaprint returned an empty fingerprint.";return false;}return true;
}
bool Engine::FingerprintTracks(std::vector<Track>& tracks,ProgressFn progress,LogFn log,std::atomic_bool& cancel,std::wstring& error){
    std::vector<int> jobs;for(int i=0;i<(int)tracks.size();++i)if(!tracks[i].excluded)jobs.push_back(i);
    unsigned workers=std::min(32u,std::max(4u,std::thread::hardware_concurrency()));std::atomic_size_t next{0},done{0};std::mutex em;std::wstring first;
    auto start=std::chrono::steady_clock::now();std::vector<std::thread> ts;
    for(unsigned w=0;w<workers;++w)ts.emplace_back([&]{while(true){size_t j=next.fetch_add(1);if(j>=jobs.size()||cancel)break;std::wstring e;if(!FingerprintOne(tracks[jobs[j]],e)){tracks[jobs[j]].fingerprint.clear();std::lock_guard l(em);if(first.empty())first=e;}
        auto d=++done;if(progress&&(d%2==0||d==jobs.size())){double sec=std::max(.001,std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count());progress({L"Fingerprinting wanted tracks ("+std::to_wstring(workers)+L" workers)",d,jobs.size(),d/sec,start});}}});
    for(auto&t:ts)t.join();if(cancel)return false;if(!first.empty()&&log)log(L"Fingerprint failures were kept as conservative singleton recordings.");return true;
}

void Engine::BuildRecordingGroups(std::vector<Track>& tracks,ProgressFn progress,LogFn log,std::atomic_bool& cancel){
    std::vector<int> eligible;for(int i=0;i<(int)tracks.size();++i)if(!tracks[i].excluded&& !tracks[i].fingerprint.empty())eligible.push_back(i);
    std::set<uint64_t> pairKeys;std::vector<std::pair<int,int>> pairs;
    auto addPair=[&](int a,int b){if(a>b)std::swap(a,b);uint64_t k=((uint64_t)(uint32_t)a<<32)|(uint32_t)b;if(pairKeys.insert(k).second)pairs.push_back({a,b});};
    std::unordered_map<std::wstring,std::vector<int>> base;
    for(int i:eligible)base[tracks[i].baseTitle].push_back(i);
    for(auto&[_,v]:base)for(size_t a=0;a<v.size();++a)for(size_t b=a+1;b<v.size();++b)addPair(v[a],v[b]);
    std::sort(eligible.begin(),eligible.end(),[&](int a,int b){return tracks[a].duration<tracks[b].duration;});
    for(size_t i=0;i<eligible.size();++i){
        auto&a=tracks[eligible[i]];
        for(size_t j=i+1;j<eligible.size();++j){
            auto&b=tracks[eligible[j]];if(b.duration-a.duration>45.0&&a.duration>0&&b.duration>0)break;
            if(SemanticConflict(a,b))continue;
            if(a.fingerprint==b.fingerprint){addPair(eligible[i],eligible[j]);continue;}
            std::unordered_set<uint32_t> ta;ta.reserve(std::min<size_t>(a.fingerprint.size(),512));
            for(size_t k=0;k<a.fingerprint.size();k+=std::max<size_t>(1,a.fingerprint.size()/256))ta.insert((a.fingerprint[k]>>20)&0xfff);
            int shared=0;for(size_t k=0;k<b.fingerprint.size();k+=std::max<size_t>(1,b.fingerprint.size()/256))if(ta.count((b.fingerprint[k]>>20)&0xfff))++shared;
            if(shared>=8)addPair(eligible[i],eligible[j]);
        }
    }
    if(log)log(L"Candidate acoustic pairs: "+std::to_wstring(pairs.size()));
    DSU dsu((int)tracks.size());std::atomic_size_t next{0},done{0};std::mutex mm;std::vector<std::pair<int,int>> matches;
    unsigned workers=std::min(32u,std::max(2u,std::thread::hardware_concurrency()));auto start=std::chrono::steady_clock::now();std::vector<std::thread> ts;
    for(unsigned w=0;w<workers;++w)ts.emplace_back([&]{while(true){size_t p=next.fetch_add(1);if(p>=pairs.size()||cancel)break;auto [a,b]=pairs[p];
        bool match=!SemanticConflict(tracks[a],tracks[b])&&FingerprintsMatch(tracks[a].fingerprint,tracks[b].fingerprint,nullptr);if(match){std::lock_guard l(mm);matches.push_back({a,b});}
        auto x=++done;if(progress&&(x%32==0||x==pairs.size())){double sec=std::max(.001,std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count());progress({L"Comparing acoustic candidates",x,pairs.size(),x/sec,start});}}});
    for(auto&t:ts)t.join();for(auto [a,b]:matches)dsu.unite(a,b);
    std::map<int,int> gids;int nextG=0;
    for(int i=0;i<(int)tracks.size();++i){
        if(tracks[i].excluded)continue;
        if(tracks[i].fingerprint.empty()){tracks[i].groupId=nextG++;continue;}
        int root=dsu.find(i);auto [it,added]=gids.emplace(root,nextG);if(added)++nextG;tracks[i].groupId=it->second;
    }
    if(log)log(L"Recording groups: "+std::to_wstring(nextG));
}

void Engine::BuildReleaseGroups(std::vector<Release>& releases,const std::vector<Track>& tracks){
    for(auto&r:releases){r.groups.clear();for(int ti:r.trackIndices)if(ti>=0&&ti<(int)tracks.size()&&!tracks[ti].excluded&&!tracks[ti].manualSkip&&tracks[ti].groupId>=0)r.groups.insert(tracks[ti].groupId);}
}
void Engine::DetectReleaseTypes(std::vector<Release>& releases){
    for(auto&r:releases){
        auto n=Lower(r.title);size_t count=r.trackIndices.size();
        if(n.find(L"compilation")!=std::wstring::npos||n.find(L"various artists")!=std::wstring::npos)r.type=ReleaseType::Compilation;
        else if(std::regex_search(n,std::wregex(LR"(\bep\b)",std::regex::icase)))r.type=ReleaseType::EP;
        else if(std::regex_search(n,std::wregex(LR"(\bsingle\b)",std::regex::icase))||count<=3)r.type=ReleaseType::Single;
        else if(count>=7)r.type=ReleaseType::Album;else r.type=ReleaseType::EP;
        r.sourceMedium=(r.hasCue&&r.hasRipLog)?L"CD/CUE":r.hasCue?L"CD/CUE":L"WEB/Unknown";
    }
}
void Engine::DetectAlbumFamilies(std::vector<Release>& releases){for(auto&r:releases)r.family=ReleaseFamily(r.title);}

void Engine::ScoreRipLogs(std::vector<Release>& releases,LogFn log){
    // Native conservative scorer: only assign a comparable score when the log is
    // clearly recognized as EAC/XLD. Unrecognized logs remain neutral rather than bad.
    for(auto&r:releases){
        for(auto&p:r.ripLogs){
            auto text=ReadTextFileUtf8(p),low=Lower(text);bool eac=low.find(L"exact audio copy")!=std::wstring::npos,xld=low.find(L"x lossless decoder")!=std::wstring::npos;
            if(!eac&&!xld)continue;int score=100;
            auto deduct=[&](const std::wstring& needle,int points){if(low.find(needle)!=std::wstring::npos)score-=points;};
            deduct(L"timing problem",10);deduct(L"suspicious position",10);deduct(L"missing samples",10);deduct(L"read error",20);deduct(L"copy aborted",100);
            if(low.find(L"accurately ripped")==std::wstring::npos&&low.find(L"no errors occurred")==std::wstring::npos&&low.find(L"all tracks accurately ripped")==std::wstring::npos)score-=10;
            score=std::clamp(score,0,100);r.ripScores.push_back(score);
        }
    }
    if(log)log(L"CD log quality parsed conservatively; unrecognized logs remain neutral.");
}

std::vector<std::pair<std::wstring,int>> Engine::CollectUnusualPatterns(const std::vector<Track>& tracks) const{
    std::map<std::wstring,int> m;for(auto&t:tracks)if(!t.unusualPattern.empty())++m[t.unusualPattern];
    std::vector<std::pair<std::wstring,int>> out(m.begin(),m.end());std::sort(out.begin(),out.end(),[](auto&a,auto&b){return a.second>b.second||(a.second==b.second&&a.first<b.first);});return out;
}

std::set<int> Engine::Optimize(std::vector<Release>& releases,const std::vector<Track>& tracks,const AnalysisOptions& options,ProgressFn progress,LogFn log){
    for(auto&r:releases)r.blocked=options.blockedReleaseIds.count(r.id)>0;
    std::set<int> active;for(auto&r:releases)if(!r.blocked)active.insert(r.id);
    // Strict same-album supersets dominate subsets before global optimization.
    std::set<int> dominated;
    for(size_t i=0;i<releases.size();++i)for(size_t j=i+1;j<releases.size();++j){
        auto&a=releases[i],&b=releases[j];if(a.blocked||b.blocked||a.type!=ReleaseType::Album||b.type!=ReleaseType::Album||a.family.empty()||a.family!=b.family)continue;
        bool ac=std::includes(a.groups.begin(),a.groups.end(),b.groups.begin(),b.groups.end()),bc=std::includes(b.groups.begin(),b.groups.end(),a.groups.begin(),a.groups.end());
        if(ac&&!bc)dominated.insert(b.id);else if(bc&&!ac)dominated.insert(a.id);
        else if(ac&&bc){
            auto key=[&](const Release&r){return std::tuple<size_t,int,int,int>{r.trackIndices.size(),-SourceRank(r),-RipClass(r),r.rootKind==RootKind::Existing?0:1};};
            if(key(a)<key(b))dominated.insert(b.id);else if(key(b)<key(a))dominated.insert(a.id);
        }
    }
    for(int id:dominated)active.erase(id);

    // Requirements: every wanted group + one most-complete edition per album family.
    struct Req{std::vector<int> providers;};
    std::vector<Req> reqs;
    std::set<int> allGroups;for(int id:active)allGroups.insert(releases[id].groups.begin(),releases[id].groups.end());
    for(int g:allGroups){Req q;for(int id:active)if(releases[id].groups.count(g))q.providers.push_back(id);if(!q.providers.empty())reqs.push_back(std::move(q));}
    std::map<std::wstring,std::vector<int>> families;
    for(int id:active)if(releases[id].type==ReleaseType::Album&&!releases[id].family.empty())families[releases[id].family].push_back(id);
    for(auto&[_,ids]:families){
        size_t maxGroups=0;for(int id:ids)maxGroups=std::max(maxGroups,releases[id].groups.size());
        Req q;for(int id:ids)if(releases[id].groups.size()==maxGroups)q.providers.push_back(id);if(!q.providers.empty())reqs.push_back(std::move(q));
    }

    std::vector<std::vector<int>> releaseReq(releases.size());
    for(int qi=0;qi<(int)reqs.size();++qi)for(int id:reqs[qi].providers)releaseReq[id].push_back(qi);
    auto covers=[&](const std::set<int>& sel){
        std::vector<char> c(reqs.size());for(int id:sel)for(int q:releaseReq[id])c[q]=1;return c;
    };
    // Greedy upper bound.
    std::set<int> best;std::vector<char> cov(reqs.size());
    while(true){
        int remain=0;for(char x:cov)if(!x)++remain;if(!remain)break;
        int bid=-1,bgain=0;double bcost=1e99;
        for(int id:active)if(!best.count(id)){
            int gain=0;for(int q:releaseReq[id])if(!cov[q])++gain;if(!gain)continue;
            double cost=(double)releases[id].trackIndices.size()/gain;
            if(cost<bcost||(cost==bcost&&gain>bgain)){bid=id;bgain=gain;bcost=cost;}
        }
        if(bid<0)break;best.insert(bid);for(int q:releaseReq[bid])cov[q]=1;
    }
    auto costKey=[&](const std::set<int>& sel){
        size_t tracksN=0;int poor=0,recycle=0,source=0,rip=0;for(int id:sel){auto&r=releases[id];tracksN+=r.trackIndices.size();poor+=SourceRank(r)>=2&&RipClass(r)==1;recycle+=r.rootKind==RootKind::Incoming;source+=SourceRank(r);rip+=RipClass(r);}
        return std::tuple<size_t,size_t,int,int,int,int>{tracksN,sel.size(),poor,-source,-rip,recycle};
    };
    auto bestCost=costKey(best);
    std::unordered_map<uint64_t,std::pair<size_t,size_t>> memo;
    std::function<void(std::set<int>&,std::vector<char>&)> dfs;
    uint64_t states=0;auto start=std::chrono::steady_clock::now();
    dfs=[&](std::set<int>&sel,std::vector<char>&c){
        if(++states%1000==0&&progress)progress({L"Optimizing collection",states,0,0,start});
        size_t pt=0;for(int id:sel)pt+=releases[id].trackIndices.size();
        if(pt>std::get<0>(bestCost)||(pt==std::get<0>(bestCost)&&sel.size()>std::get<1>(bestCost)))return;
        int qpick=-1,minp=INT_MAX;bool complete=true;
        for(int q=0;q<(int)reqs.size();++q)if(!c[q]){complete=false;int p=0;for(int id:reqs[q].providers)if(active.count(id))++p;if(p<minp){minp=p;qpick=q;}}
        if(complete){auto ck=costKey(sel);if(ck<bestCost){best=sel;bestCost=ck;}return;}
        // Small memo on covered bitset + partial first two costs.
        std::vector<uint64_t> words((c.size()+63)/64);for(size_t i=0;i<c.size();++i)if(c[i])words[i/64]|=1ULL<<(i%64);
        uint64_t h=HashWords(words);auto it=memo.find(h);auto part=std::make_pair(pt,sel.size());if(it!=memo.end()&&it->second<=part)return;memo[h]=part;
        auto providers=reqs[qpick].providers;
        std::sort(providers.begin(),providers.end(),[&](int a,int b){return releases[a].trackIndices.size()<releases[b].trackIndices.size();});
        for(int id:providers)if(active.count(id)&&!sel.count(id)){
            sel.insert(id);auto next=c;for(int q:releaseReq[id])next[q]=1;dfs(sel,next);sel.erase(id);
        }
    };
    std::set<int> empty;std::vector<char> none(reqs.size());dfs(empty,none);
    if(log)log(L"Exact optimizer states: "+std::to_wstring(states)+L"; selected "+std::to_wstring(best.size())+L" release(s)");
    return best;
}

bool Engine::MeasureDynamics(Track& t,std::wstring& error){
    std::vector<std::wstring> cmd{ffmpeg_.wstring(),L"-hide_banner",L"-nostats",L"-loglevel",L"info"};
    if(t.virtualCue&&t.cueStart>0){cmd.push_back(L"-ss");cmd.push_back(std::to_wstring(t.cueStart));}
    cmd.insert(cmd.end(),{L"-i",(t.virtualCue?t.cueImage:t.path).wstring()});
    if(t.virtualCue&&t.duration>0){cmd.push_back(L"-t");cmd.push_back(std::to_wstring(t.duration));}
    cmd.insert(cmd.end(),{L"-map",L"0:a:0",L"-vn",L"-af",L"ebur128=peak=true,astats=metadata=0:reset=0",L"-f",L"null",L"NUL"});
    auto r=RunCapture(cmd,900000);if(r.code!=0){error=r.out;return false;}
    auto last=[&](const std::wregex& re)->std::optional<double>{std::optional<double>v;for(auto i=std::wsregex_iterator(r.out.begin(),r.out.end(),re),e=std::wsregex_iterator();i!=e;++i)v=_wtof((*i)[1].str().c_str());return v;};
    t.lufs=last(std::wregex(LR"(\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS)",std::regex::icase));
    t.lra=last(std::wregex(LR"(\bLRA:\s*(-?\d+(?:\.\d+)?)\s+LU)",std::regex::icase));
    t.truePeak=last(std::wregex(LR"(\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS)",std::regex::icase));
    t.rms=last(std::wregex(LR"(RMS level dB:\s*(-?\d+(?:\.\d+)?))",std::regex::icase));
    if(t.truePeak&&t.rms)t.crest=*t.truePeak-*t.rms;
    if(t.crest)t.dynamicScore=*t.crest+0.35*std::max(0.0,t.lra.value_or(0.0));
    return true;
}

void Engine::ApplyDynamicRangeFinalTies(std::vector<Release>& releases,std::vector<Track>& tracks,std::set<int>& selected,ProgressFn progress,LogFn log){
    // Only exact interchangeable alternatives that tie on every non-DR criterion reach here.
    int checked=0;
    for(int sid:std::vector<int>(selected.begin(),selected.end())){
        auto&s=releases[sid];int best=sid;double bestScore=-1e99;
        for(auto&c:releases){
            if(c.id==sid||c.blocked||selected.count(c.id))continue;
            if(c.groups!=s.groups||c.trackIndices.size()!=s.trackIndices.size()||SourceRank(c)!=SourceRank(s)||RipClass(c)!=RipClass(s)||c.rootKind!=s.rootKind)continue;
            for(int id:{sid,c.id}){
                auto&r=releases[id];double sum=0;int n=0;
                for(int ti:r.trackIndices){auto&t=tracks[ti];if(t.excluded)continue;if(!t.dynamicScore){std::wstring e;MeasureDynamics(t,e);}if(t.dynamicScore){sum+=*t.dynamicScore;++n;}}
                double score=n?sum/n:-1e99;if(score>bestScore){bestScore=score;best=id;}
            }
            ++checked;
        }
        if(best!=sid){selected.erase(sid);selected.insert(best);}
    }
    if(checked&&log)log(L"DR final-tie comparisons: "+std::to_wstring(checked));
}

bool Engine::Analyze(const Settings& settings,const AnalysisOptions& options,AnalysisResult& out,PatternReviewFn patternReview,ProgressFn progress,LogFn log,std::atomic_bool& cancel,std::wstring& error){
    out={};auto started=std::chrono::steady_clock::now();
    if(!EnsureDependencies(progress,log,error))return false;
    if(settings.incoming.empty()||!fs::is_directory(settings.incoming)){error=L"Select a valid New / update releases folder.";return false;}
    if(!settings.existing.empty()&&!fs::is_directory(settings.existing)){error=L"Existing discography folder is invalid.";return false;}
    if(!settings.existing.empty()){
        std::error_code ec;auto a=fs::weakly_canonical(settings.existing,ec),b=fs::weakly_canonical(settings.incoming,ec);
        if(a==b){error=L"Existing discography and New / update releases must be separate folders.";return false;}
    }
    if(log)log(L"Scanning release folders");
    if(!settings.existing.empty()&&!ScanRoot(settings.existing,RootKind::Existing,out.releases,out.tracks,progress,log,cancel,error))return false;
    if(!ScanRoot(settings.incoming,RootKind::Incoming,out.releases,out.tracks,progress,log,cancel,error))return false;
    out.totalFiles=out.tracks.size();
    if(!ProbeTracks(out.tracks,progress,log,cancel,error))return false;

    AnalysisOptions effectiveOptions=options;
    for(auto& t:out.tracks)t.unusualPattern=DetectUnusualPattern(t.title);
    auto unusual=CollectUnusualPatterns(out.tracks);
    if(!unusual.empty()&&patternReview){
        effectiveOptions.keptPatterns=patternReview(unusual);
        if(cancel)return false;
    }
    ClassifyTracks(out.releases,out.tracks,effectiveOptions,log);
    for(auto&t:out.tracks){if(t.excluded)++out.excludedTracks;else ++out.eligibleTracks;}
    DetectReleaseTypes(out.releases);DetectAlbumFamilies(out.releases);ScoreRipLogs(out.releases,log);
    if(!FingerprintTracks(out.tracks,progress,log,cancel,error))return false;
    BuildRecordingGroups(out.tracks,progress,log,cancel);if(cancel)return false;
    BuildReleaseGroups(out.releases,out.tracks);
    out.selectedReleases=Optimize(out.releases,out.tracks,effectiveOptions,progress,log);
    ApplyDynamicRangeFinalTies(out.releases,out.tracks,out.selectedReleases,progress,log);
    for(auto&r:out.releases)r.selected=out.selectedReleases.count(r.id)>0;
    if(progress)progress({L"Analysis complete",out.tracks.size(),out.tracks.size(),0,started});
    return true;
}

bool Engine::Reoptimize(AnalysisResult& result,const AnalysisOptions& options,ProgressFn progress,LogFn log,std::wstring& error){
    (void)error;BuildReleaseGroups(result.releases,result.tracks);
    result.selectedReleases=Optimize(result.releases,result.tracks,options,progress,log);
    ApplyDynamicRangeFinalTies(result.releases,result.tracks,result.selectedReleases,progress,log);
    for(auto&r:result.releases)r.selected=result.selectedReleases.count(r.id)>0;return true;
}

bool Engine::ApplyPlan(const AnalysisResult& result,const Settings& settings,LogFn log,std::wstring& error){
    fs::path dupRoot=settings.incoming/L"!Duplicates";fs::create_directories(dupRoot);
    fs::path remixRoot=settings.incoming/L"!Remixes";fs::create_directories(remixRoot);
    std::wofstream manifest(paths_.undoManifest,std::ios::trunc);if(!manifest){error=L"Could not create undo manifest.";return false;}
    auto move=[&](const fs::path&src,const fs::path&dstRoot)->bool{
        std::error_code ec;if(!fs::exists(src,ec))return true;
        fs::path dst=dstRoot/src.filename();int n=2;while(fs::exists(dst,ec))dst=dstRoot/(src.filename().wstring()+L" ("+std::to_wstring(n++)+L")");
        fs::rename(src,dst,ec);if(ec){error=L"Could not move:\n\n"+src.wstring()+L"\n\nto:\n\n"+dst.wstring()+L"\n\n"+Utf8ToWide(ec.message());return false;}
        manifest<<src.wstring()<<L"\t"<<dst.wstring()<<L"\n";if(log)log(L"Moved: "+src.filename().wstring());return true;
    };
    for(auto&r:result.releases){
        if(r.rootKind!=RootKind::Incoming||result.selectedReleases.count(r.id))continue;
        bool remixOnly=true,any=false;for(int ti:r.trackIndices){auto&t=result.tracks[ti];any=true;if(!t.isRemix)remixOnly=false;}
        for(auto&p:r.physicalPaths)if(!move(p,(any&&remixOnly)?remixRoot:dupRoot))return false;
    }
    // When Existing is supplied, retained incoming releases are integrated there.
    if(!settings.existing.empty()){
        for(auto&r:result.releases)if(r.rootKind==RootKind::Incoming&&result.selectedReleases.count(r.id)){
            for(auto&p:r.physicalPaths)if(fs::exists(p)){
                fs::path dst=settings.existing/p.filename();std::error_code ec;if(fs::exists(dst,ec))continue;
                fs::rename(p,dst,ec);if(!ec){manifest<<p.wstring()<<L"\t"<<dst.wstring()<<L"\n";if(log)log(L"Added to Existing: "+p.filename().wstring());}
            }
        }
    }
    return true;
}
bool Engine::UndoLastRun(LogFn log,std::wstring& error){
    if(!fs::exists(paths_.undoManifest)){error=L"No undo manifest found.";return false;}
    std::wifstream in(paths_.undoManifest);std::vector<std::pair<fs::path,fs::path>> moves;std::wstring line;
    while(std::getline(in,line)){auto p=line.find(L'\t');if(p!=std::wstring::npos)moves.push_back({line.substr(0,p),line.substr(p+1)});}
    for(auto it=moves.rbegin();it!=moves.rend();++it){std::error_code ec;if(fs::exists(it->second,ec)&&!fs::exists(it->first,ec)){fs::create_directories(it->first.parent_path(),ec);fs::rename(it->second,it->first,ec);if(ec){error=L"Undo failed:\n\n"+it->second.wstring();return false;}if(log)log(L"Restored: "+it->first.filename().wstring());}}
    fs::remove(paths_.undoManifest);return true;
}

bool Engine::SelfTest(std::wstring& report){
    std::vector<std::wstring> failures;
    auto chk=[&](bool ok,const wchar_t* msg){if(!ok)failures.push_back(msg);};
    chk(DetectRecordingRoot(L"Girlfriend (Extended Version)")==RecordingRoot::Extended,L"Extended base must be unique.");
    chk(DetectRecordingRoot(L"Girlfriend (Instrumental)")==RecordingRoot::Instrumental,L"Instrumental must be unique.");
    chk(DetectRecordingRoot(L"Push (Acoustic)")==RecordingRoot::Acoustic,L"Acoustic must be unique.");
    chk(DetectRecordingRoot(L"Girlfriend (Dr. Luke Remix) (Extended Version)")==RecordingRoot::Remix,L"Remix parent precedence failed.");
    Track a,b;a.title=L"Girlfriend";b.title=L"Girlfriend (Radio Edit)";a.root=DetectRecordingRoot(a.title);b.root=DetectRecordingRoot(b.title);a.rootKey=RecordingRootKey(a.title);b.rootKey=RecordingRootKey(b.title);
    chk(!SemanticConflict(a,b),L"Radio Edit must stay comparable to base.");
    b.title=L"Girlfriend (Extended Version)";b.root=DetectRecordingRoot(b.title);b.rootKey=RecordingRootKey(b.title);chk(SemanticConflict(a,b),L"Extended must not replace base.");
    chk(DetectUnusualPattern(L"Song (Suggested Callout)")==L"suggested callout",L"Unusual callout pattern detection failed.");
    chk(DetectUnusualPattern(L"Artist - Song").empty(),L"Artist-title separator false positive.");
    chk(IsKnownDescriptor(L"Radio Edit"),L"Known descriptor classification failed.");
    if(failures.empty()){report=L"Native DEA self-test passed.";return true;}
    report=L"Native DEA self-test failed:\n";for(auto&f:failures)report+=L"- "+f+L"\n";return false;
}

} // namespace dea
