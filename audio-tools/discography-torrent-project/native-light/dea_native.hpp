#pragma once
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <winhttp.h>
#include <dwmapi.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <iomanip>
#include <map>
#include <memory>
#include <mutex>
#include <numeric>
#include <optional>
#include <queue>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace dea {
namespace fs = std::filesystem;

inline constexpr wchar_t APP_NAME[] = L"Duplicate / Edition Analyzer Native";
inline constexpr wchar_t APP_VERSION[] = L"0.1.1";
inline constexpr wchar_t STATUS_TEXT[] = L"Under construction \x26A0";
inline constexpr wchar_t PROGRAM_DIR_NAME[] = L"Duplicate Edition Analyzer Native Test";

enum class RootKind { Existing, Incoming };
enum class ReleaseType { Album, EP, Single, Compilation, Unknown };
enum class RecordingRoot { Base, Extended, Instrumental, Acapella, Acoustic, Live, Remix };

struct AppPaths {
    fs::path root;
    fs::path dependencies;
    fs::path logs;
    fs::path temp;
    fs::path cache;
    fs::path state;
    fs::path settings;
    fs::path undoManifest;
};

struct PersonalPick {
    enum class Mode { Contains, Exact, Pattern };
    Mode mode{Mode::Contains};
    std::wstring value;
    std::wstring key;
};

struct Settings {
    fs::path existing;
    fs::path incoming;
    bool saveRemixes{false};
    bool saveLive{false};
    bool logging{false};
    std::vector<PersonalPick> personalPicks;
};

struct Track {
    int releaseId{-1};
    int index{0};
    fs::path path;
    std::wstring title;
    std::wstring artist;
    std::wstring album;
    std::wstring codec;
    double duration{0.0};
    int sampleRate{0};
    int bitDepth{0};
    int channels{0};
    uint64_t fileSize{0};

    bool virtualCue{false};
    fs::path cuePath;
    fs::path cueImage;
    int cueTrackNo{0};
    double cueStart{0.0};
    double cueEnd{0.0};

    bool isRemix{false};
    bool isLive{false};
    bool remixFeatureException{false};
    bool excluded{false};
    bool manualSkip{false};
    bool explicitTrack{false};
    bool cleanTrack{false};

    RecordingRoot root{RecordingRoot::Base};
    std::wstring baseTitle;
    std::wstring rootKey;
    std::wstring unusualPattern;

    std::vector<uint32_t> fingerprint;
    double fingerprintDuration{0.0};
    int groupId{-1};

    std::optional<double> lufs;
    std::optional<double> lra;
    std::optional<double> truePeak;
    std::optional<double> rms;
    std::optional<double> crest;
    std::optional<double> dynamicScore;
};

struct Release {
    int id{-1};
    RootKind rootKind{RootKind::Incoming};
    ReleaseType type{ReleaseType::Unknown};
    fs::path path;
    std::vector<fs::path> physicalPaths;
    fs::path scanRoot;
    std::wstring title;
    std::wstring family;
    std::vector<int> trackIndices;
    std::set<int> groups;
    bool blocked{false};
    bool selected{false};
    bool pendingIgnore{false};
    bool pendingRestore{false};
    bool manualRemoved{false};
    bool hasCue{false};
    bool hasRipLog{false};
    bool hasAudioChecker{false};
    std::vector<fs::path> ripLogs;
    std::vector<int> ripScores;
    int ripFlagged{0};
    std::wstring sourceMedium{L"Unknown"};
};

struct AnalysisOptions {
    bool saveRemixes{false};
    bool saveLive{false};
    bool logging{false};
    std::set<std::wstring> keptPatterns;
    std::vector<PersonalPick> personalPicks;
    std::set<int> blockedReleaseIds;
};

struct Progress {
    std::wstring stage;
    uint64_t current{0};
    uint64_t total{0};
    double rate{0.0};
    std::chrono::steady_clock::time_point started{std::chrono::steady_clock::now()};
};

struct AnalysisResult {
    std::vector<Track> tracks;
    std::vector<Release> releases;
    std::set<int> selectedReleases;
    std::vector<std::wstring> activity;
    std::vector<std::wstring> warnings;
    uint64_t totalFiles{0};
    uint64_t eligibleTracks{0};
    uint64_t excludedTracks{0};
};

struct FingerprintSimilarity {
    double score{0};
    double good{0};
    double overlap{0};
    int shift{0};
    double excellent{0};
    double median{0};
    int p90{0};
};

class Engine {
public:
    using ProgressFn = std::function<void(const Progress&)>;
    using LogFn = std::function<void(const std::wstring&)>;
    using PatternReviewFn = std::function<std::set<std::wstring>(
        const std::vector<std::pair<std::wstring,int>>&
    )>;

    Engine();
    const AppPaths& Paths() const { return paths_; }

    Settings LoadSettings() const;
    bool SaveSettings(const Settings& s) const;

    bool EnsureDependencies(ProgressFn progress, LogFn log, std::wstring& error);
    bool Analyze(const Settings& settings, const AnalysisOptions& options, AnalysisResult& out,
                 PatternReviewFn patternReview, ProgressFn progress, LogFn log,
                 std::atomic_bool& cancel, std::wstring& error);
    bool Reoptimize(AnalysisResult& result, const AnalysisOptions& options, ProgressFn progress,
                    LogFn log, std::wstring& error);
    bool ApplyPlan(const AnalysisResult& result, const Settings& settings, LogFn log, std::wstring& error);
    bool UndoLastRun(LogFn log, std::wstring& error);

    std::vector<std::pair<std::wstring,int>> CollectUnusualPatterns(const std::vector<Track>& tracks) const;

    static std::wstring Normalize(const std::wstring& value);
    static std::wstring BaseTitle(const std::wstring& value);
    static RecordingRoot DetectRecordingRoot(const std::wstring& title);
    static std::wstring RecordingRootKey(const std::wstring& title);
    static bool IsRemixText(const std::wstring& title);
    static bool IsLiveText(const std::wstring& title);
    static bool IsKnownDescriptor(const std::wstring& descriptor);
    static std::wstring DetectUnusualPattern(const std::wstring& title);
    static bool SemanticConflict(const Track& a, const Track& b);

    static std::optional<FingerprintSimilarity> CompareFingerprints(
        const std::vector<uint32_t>& a, const std::vector<uint32_t>& b);
    static bool FingerprintsMatch(const std::vector<uint32_t>& a, const std::vector<uint32_t>& b,
                                  FingerprintSimilarity* sim = nullptr);

    static bool SelfTest(std::wstring& report);

private:
    AppPaths paths_;
    fs::path ffmpeg_;
    fs::path ffprobe_;
    fs::path fpcalc_;

    bool ScanRoot(const fs::path& root, RootKind kind, std::vector<Release>& releases,
                  std::vector<Track>& tracks, ProgressFn progress, LogFn log,
                  std::atomic_bool& cancel, std::wstring& error);
    void GroupDiscFolders(std::vector<Release>& releases, std::vector<Track>& tracks);
    void ClassifyTracks(std::vector<Release>& releases, std::vector<Track>& tracks,
                        const AnalysisOptions& options, LogFn log);
    bool ProbeTracks(std::vector<Track>& tracks, ProgressFn progress, LogFn log,
                     std::atomic_bool& cancel, std::wstring& error);
    bool FingerprintTracks(std::vector<Track>& tracks, ProgressFn progress, LogFn log,
                           std::atomic_bool& cancel, std::wstring& error);
    void BuildRecordingGroups(std::vector<Track>& tracks, ProgressFn progress, LogFn log,
                              std::atomic_bool& cancel);
    void ApplyExplicitCleanPolicy(std::vector<Track>& tracks);
    void BuildReleaseGroups(std::vector<Release>& releases, const std::vector<Track>& tracks);
    void DetectReleaseTypes(std::vector<Release>& releases);
    void DetectAlbumFamilies(std::vector<Release>& releases);
    std::set<int> Optimize(std::vector<Release>& releases, const std::vector<Track>& tracks,
                           const AnalysisOptions& options, ProgressFn progress, LogFn log);
    void ApplyDynamicRangeFinalTies(std::vector<Release>& releases, std::vector<Track>& tracks,
                                   std::set<int>& selected, ProgressFn progress, LogFn log);
    bool MeasureDynamics(Track& t, std::wstring& error);
    void ScoreRipLogs(std::vector<Release>& releases, LogFn log);

    bool ProbeOne(Track& t, std::wstring& error);
    bool FingerprintOne(Track& t, std::wstring& error);
};

class MainWindow {
public:
    explicit MainWindow(HINSTANCE instance);
    int Run();

    AnalysisResult& Result() { return result_; }
    Settings& CurrentSettings() { return settings_; }
    Engine& Core() { return engine_; }
    HFONT UiFont() const { return font_; }
    HBRUSH PanelBrush() const { return panelBrush_; }
    HBRUSH FieldBrush() const { return fieldBrush_; }
    uint64_t InitialReleaseCount() const { return initialReleaseCount_; }
    uint64_t InitialTrackCount() const { return initialTrackCount_; }
    void LogUi(const std::wstring& s) { AppendActivity(s); }
    void RefreshButtons() { UpdateButtons(); }

private:
    HINSTANCE instance_{};
    HWND hwnd_{};
    HWND existingEdit_{};
    HWND incomingEdit_{};
    HWND saveRemixes_{};
    HWND saveLive_{};
    HWND logging_{};
    HWND progress_{};
    HWND status_{};
    HWND detail_{};
    HWND activity_{};
    HWND analyze_{};
    HWND undo_{};
    HWND map_{};
    HWND personal_{};
    HWND openLogs_{};

    HFONT font_{};
    HFONT fontBold_{};
    HFONT fontMajor_{};
    HFONT fontMono_{};
    HBRUSH bgBrush_{};
    HBRUSH panelBrush_{};
    HBRUSH fieldBrush_{};

    Engine engine_;
    Settings settings_;
    AnalysisResult result_;
    std::atomic_bool cancel_{false};
    std::thread worker_;
    std::mutex resultMutex_;
    bool running_{false};
    uint64_t initialReleaseCount_{0};
    uint64_t initialTrackCount_{0};

    static LRESULT CALLBACK WndProc(HWND, UINT, WPARAM, LPARAM);
    static LRESULT CALLBACK ReleaseMapProc(HWND, UINT, WPARAM, LPARAM);
    LRESULT HandleMessage(UINT, WPARAM, LPARAM);

    void CreateUi();
    void Layout(int width, int height);
    void ApplyDarkMode(HWND);
    void SetFonts(HWND);
    void BrowseInto(HWND edit);
    void OpenDisplayedPath(HWND edit);
    void StartAnalyze();
    void FinishAnalyze(bool ok, const std::wstring& error);
    void SetProgress(const Progress& p);
    void AppendActivity(const std::wstring& line);
    void OpenReleaseMap();
    void OpenPersonalPicks();
    void OpenUnusualPatternReview(const std::vector<std::pair<std::wstring,int>>& patterns,
                                  std::set<std::wstring>& kept);
    void UpdateButtons();
    void SaveUiSettings();
    std::wstring Text(HWND h) const;
    void SetText(HWND h, const std::wstring& s);
};

AppPaths ResolveAppPaths();
bool OpenPathLocation(const fs::path& path, std::wstring& error);
std::wstring ReadTextFileUtf8(const fs::path& path);
bool WriteTextFileUtf8(const fs::path& path, const std::wstring& text);
std::wstring Utf8ToWide(const std::string& s);
std::string WideToUtf8(const std::wstring& s);

} // namespace dea
