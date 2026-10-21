# Audio Analysis Suite v0.01.00 - Under construction
# Independent experimental implementation. NOT DROffline / AudioChecker parity.
# Python 3.10+; double-click .pyw on Windows to start GUI (auto-installs missing packages).
from __future__ import annotations
import csv
import datetime as dt
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass

VERSION = '0.01.00'
PRODUCT = 'Audio Analysis Suite'
EXTENSIONS = {'.wav','.wave','.bwf','.flac','.aiff','.aif','.aifc','.alac','.m4a','.mp4',
    '.aac','.mp3','.ogg','.oga','.opus','.wma','.ape','.wv','.tta','.tak','.dsf','.dff',
    '.ac3','.eac3','.dts','.caf','.au','.snd','.amr','.mp2','.mpc','.mka','.webm','.flv'}
LOSSY_CODECS = {'mp3','aac','opus','vorbis','wma','wmav2','wmapro','wmavoice','mp2','ac3',
    'eac3','dts','amr_nb','amr_wb','atrac3','atrac3p','speex','musepack','mpc7','mpc8'}
HEADERS = ['File','Status','Duration','Rate','Channels','DR (experimental)','LUFSi (BS.1770)',
           'True peak (dBTP)','Authenticity (experimental)','Codec','Details']


def data_root():
    if os.name == 'nt':
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(32768)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0:
                return Path(buf.value) / 'Karpuzikov Tools' / PRODUCT
        except Exception:
            pass
    return Path.home() / 'Documents' / 'Karpuzikov Tools' / PRODUCT


def ensure_dirs():
    root = data_root()
    for child in ('logs','settings','temp','dependencies','cache'):
        (root / child).mkdir(parents=True, exist_ok=True)
    return root


def log_path(operation='run'):
    folder = ensure_dirs() / 'logs'
    date = dt.datetime.now().strftime('%Y-%m-%d-%H-%M-%S')
    return folder / f'{operation}-{date}-{uuid.uuid4().hex[:8]}.log'


def require_packages(gui=False):
    modules = {'numpy':'numpy','scipy':'scipy','pyloudnorm':'pyloudnorm'}
    if gui:
        modules['PySide6'] = 'PySide6'
    missing = [pkg for mod,pkg in modules.items() if importlib.util.find_spec(mod) is None]
    if not missing:
        return
    path = log_path('dependencies')
    cmd = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', *missing]
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    with path.open('w',encoding='utf-8') as f:
        result = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=900,
                                creationflags=flags)
    if result.returncode != 0:
        raise RuntimeError(f'Unable to install {", ".join(missing)}. See {path}')
    importlib.invalidate_caches()


def ffmpeg_paths():
    """winget/system FFmpeg preferred; imageio-ffmpeg fallback if unavailable."""
    ff = shutil.which('ffmpeg')
    fp = shutil.which('ffprobe')
    if not ff and os.name == 'nt' and shutil.which('winget'):
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        try:
            subprocess.run(['winget','install','--id','Gyan.FFmpeg','-e',
                 '--accept-source-agreements','--accept-package-agreements','--silent'],
                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=150,
                 creationflags=flags)
        except (OSError, subprocess.TimeoutExpired):
            pass
        ff,fp = shutil.which('ffmpeg'),shutil.which('ffprobe')
    if not ff:
        if importlib.util.find_spec('imageio_ffmpeg') is None:
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            result = subprocess.run([sys.executable,'-m','pip','install',
                  '--disable-pip-version-check','imageio-ffmpeg'],
                  stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                  timeout=240,creationflags=flags)
            if result.returncode:
                raise RuntimeError('FFmpeg installation failed. Install FFmpeg using winget.')
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    return ff, fp


def probe_audio(path, ff, fp):
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    if fp:
        cmd=[fp,'-v','error','-select_streams','a:0','-show_entries',
             'stream=codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,sample_fmt:format=duration',
             '-of','json',str(path)]
        p=subprocess.run(cmd,capture_output=True,text=True,errors='replace',timeout=45,creationflags=flags)
        if p.returncode == 0:
            data=json.loads(p.stdout)
            streams=data.get('streams',[])
            if streams:
                s=streams[0]
                return dict(rate=int(s['sample_rate']),channels=int(s['channels']),
                            codec=s.get('codec_name','unknown'),duration=float(data.get('format',{}).get('duration') or 0),
                            bits=s.get('bits_per_raw_sample') or s.get('bits_per_sample') or '')
    # FFmpeg's stream summary works without ffprobe and covers bundled portable FFmpeg.
    p=subprocess.run([ff,'-hide_banner','-nostdin','-i',str(path)],
                     capture_output=True,text=True,errors='replace',timeout=45,creationflags=flags)
    summary=p.stderr
    a=next((s for s in summary.splitlines() if 'Audio:' in s), '')
    sr=re.search(r'(\d+) Hz',a)
    # Use explicit channel counts before mono/stereo labels.
    ch=re.search(r'(\d+) channels?',a)
    channels=int(ch.group(1)) if ch else (1 if re.search(r'\bmono\b',a) else 2 if re.search(r'\bstereo\b',a) else 0)
    codec=re.search(r'Audio:\s*([^, ]+)',a)
    du=re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)',summary)
    duration=sum(float(n)*weight for n,weight in zip(du.groups(),[3600,60,1])) if du else 0.0
    if not sr or not channels:
        raise ValueError('No supported audio stream found')
    return dict(rate=int(sr.group(1)),channels=channels,
                codec=codec.group(1).lower() if codec else 'unknown', duration=duration,bits='')


def spawn_decode(src, dst, info, ff, stop):
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    cmd=[ff,'-hide_banner','-loglevel','error','-nostdin','-threads','1',
         '-i',str(src),'-map','0:a:0','-vn','-sn','-dn','-f','f32le',
         '-acodec','pcm_f32le','-ac',str(info['channels']),'-ar',str(info['rate']),
         '-y',str(dst)]
    # Child is reaped on cancellation. This never writes to source audio.
    p=subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=flags)
    try:
        while p.poll() is None:
            if stop.is_set():
                p.kill()
                p.communicate(timeout=10)
                raise InterruptedError('Cancelled')
            time.sleep(.08)
        stderr=p.stderr.read().decode('utf-8','replace') if p.stderr else ''
        if p.returncode:
            raise RuntimeError('Decoder failed: '+stderr[-350:].strip())
    finally:
        if p.poll() is None:
            p.kill()
            p.communicate(timeout=10)


def db(value, floor=-100.0):
    value=float(value)
    return max(floor,20*math.log10(value)) if value>0 else floor


def pmf_estimate(pcm, rate, stop):
    """Independent 3-second loudest-block crest estimate. NOT validated PMF parity."""
    import numpy as np
    frames=len(pcm)
    if frames<rate*10:
        return None
    block=max(1,int(rate*3))
    nchan=pcm.shape[1]
    peak=np.zeros(nchan,dtype=np.float64)
    squares=[[] for _ in range(nchan)]
    for start in range(0,frames,block):
        if stop.is_set(): raise InterruptedError('Cancelled')
        part=np.asarray(pcm[start:min(start+block,frames)],dtype=np.float64)
        if len(part)<block: # This is unverified versus the original's final-block rule.
            continue
        peak=np.maximum(peak,np.max(np.abs(part),axis=0))
        mean_sq=np.mean(part*part,axis=0)
        for i,v in enumerate(mean_sq): squares[i].append(float(v))
    if not squares[0] or not np.any(peak):
        return 0
    values=[]
    for ch in range(nchan):
        e=sorted(squares[ch],reverse=True)
        keep=max(1,int(math.ceil(len(e)*.2)))
        rms=math.sqrt(sum(e[:keep])/keep)
        values.append(db(peak[ch])-db(rms)-3.0103)
    return int(math.floor(float(np.mean(values))+0.5))


def true_peak(pcm, sr, stop):
    import numpy as np
    from scipy.signal import resample_poly
    ratio=4 if sr<96000 else 2 if sr<192000 else 1
    maximum=0.0
    chunk=max(10000,sr*5)
    # FIR overlap avoids interpolation discontinuities at chunk edges.
    edge=64
    for begin in range(0,len(pcm),chunk):
        if stop.is_set(): raise InterruptedError('Cancelled')
        end=min(begin+chunk,len(pcm))
        left=max(0,begin-edge)
        right=min(len(pcm),end+edge)
        data=np.asarray(pcm[left:right],dtype=np.float64)
        if not len(data):continue
        if ratio>1:
            high=resample_poly(data,ratio,1,axis=0)
            a=(begin-left)*ratio
            b=a+(end-begin)*ratio
            high=high[a:b]
        else:
            high=data[(begin-left):(end-left)]
        if high.size:
            maximum=max(maximum,float(np.max(np.abs(high))))
    return db(maximum)


def loudness(pcm,sr,stop):
    """Streaming BS.1770 K weighting plus absolute and relative 400ms gates."""
    import numpy as np
    from scipy.signal import lfilter
    import pyloudnorm as pyln
    nchan=pcm.shape[1]
    if len(pcm)<int(.4*sr) or not np.any(pcm[::max(1,sr//4)]):
        # A sparse signal could be missed by the coarse silence check, so
        # use a full scan before declaring digital silence.
        if len(pcm)<int(.4*sr) or not np.any(pcm):return -128.0
    gains={1:[1],2:[1,1],3:[1,1,1],4:[1,1,1.41,1.41],
           5:[1,1,1,1.41,1.41],6:[1,1,1,0,1.41,1.41],
           8:[1,1,1,0,1.41,1.41,1.41,1.41]}
    if nchan not in gains:
        raise ValueError(f'Loudness layout with {nchan} channels is not mapped')
    # Filter states persist between chunks; no whole-track float64 copy.
    stages=[(f.b,f.a) for f in pyln.Meter(sr,block_size=.4)._filters.values()]
    zi=[np.zeros((max(len(a),len(b))-1,nchan),dtype=np.float64) for b,a in stages]
    step=max(1,int(round(sr*.1)))
    partial=np.zeros(nchan,dtype=np.float64)
    partial_count=0
    quarter=[]
    windows=[]
    for start in range(0,len(pcm),max(step*12,24000)):
        if stop.is_set():raise InterruptedError('Cancelled')
        block=np.asarray(pcm[start:start+max(step*12,24000)],dtype=np.float64)
        for idx,(b,a) in enumerate(stages):
            block,zi[idx]=lfilter(b,a,block,axis=0,zi=zi[idx])
        offset=0
        while offset<len(block):
            amount=min(len(block)-offset,step-partial_count)
            piece=block[offset:offset+amount]
            partial+=np.sum(piece*piece,axis=0)
            partial_count+=amount;offset+=amount
            if partial_count==step:
                quarter.append(partial / step)
                if len(quarter)==4:
                    windows.append(np.mean(quarter,axis=0))
                    quarter.pop(0)
                partial=np.zeros(nchan,dtype=np.float64)
                partial_count=0
    if not windows:return -128.0
    z=np.asarray(windows,dtype=np.float64)
    weights=np.asarray(gains[nchan],dtype=np.float64)
    summed=z@weights
    loud=np.full(len(summed),-np.inf,dtype=np.float64)
    valid=summed>0
    loud[valid]=-0.691+10*np.log10(summed[valid])
    above=loud>=-70
    if not np.any(above):return -128.0
    rel=-0.691+10*np.log10(float(np.mean(z[above],axis=0)@weights))-10
    included=(loud>max(-70,rel))
    if not np.any(included):return -128.0
    energy=float(np.mean(z[included],axis=0)@weights)
    return float(-0.691+10*np.log10(energy)) if energy>0 else -128.0


def authenticity(pcm,sr,codec,stop):
    """Informational high-frequency spectral screen, never auCDtect certification."""
    import numpy as np
    from scipy.signal import welch
    if stop.is_set():raise InterruptedError('Cancelled')
    codec=codec.lower()
    if codec in LOSSY_CODECS:
        return 'Lossy codec', 'File is encoded in a known lossy format; previous history unknown'
    if sr<40000:
        return 'Indeterminate','Sample rate is insufficient for high-band inspection'
    # Use multiple windows throughout the recording so silence doesn't dominate.
    duration=len(pcm)/sr
    if duration<5:
        return 'Indeterminate','Too short for a useful spectral screen'
    take=min(12,max(4,int(duration/8)))
    width=min(65536,max(8192,int(sr*.35)))
    if len(pcm)<width:return 'Indeterminate','Too few samples'
    spectra=[]
    for pos in np.linspace(0,len(pcm)-width,take,dtype=int):
        if stop.is_set():raise InterruptedError('Cancelled')
        sample=np.asarray(pcm[pos:pos+width],dtype=np.float64)
        sample=sample.mean(axis=1)
        if float(np.sqrt(np.mean(sample*sample)))<1e-5: continue
        frequencies, power=welch(sample,fs=sr,nperseg=min(8192,len(sample)))
        spectra.append(power)
    if len(spectra)<3:
        return 'Indeterminate','Insufficient non-silent content'
    spectrum=np.mean(spectra,axis=0)
    f=frequencies
    # Strong steep lowpass well below Nyquist is evidence, not proof, of transcoding.
    for cutoff in (16000,17500,19000):
        if cutoff+1250>=sr/2:continue
        lower=spectrum[(f>=cutoff-2000)&(f<cutoff-500)]
        upper=spectrum[(f>=cutoff+500)&(f<cutoff+1750)]
        if not len(lower) or not len(upper):continue
        lo=float(np.mean(lower)); hi=float(np.mean(upper))
        if lo>1e-12 and hi<lo*1e-4:
            return 'Possible lowpass',f'Spectral energy drops steeply near {cutoff/1000:g} kHz; not conclusive'
    return 'Indeterminate','No conclusive authenticity evidence; not verified lossless'


@dataclass
class Result:
    path:str
    status:str='Queued'
    duration:float=0.0
    rate:int=0
    channels:int=0
    dr:int|None=None
    lufs:float|None=None
    peak:float|None=None
    authenticity:str=''
    codec:str=''
    detail:str=''

    def cells(self):
        return [str(Path(self.path).name),self.status,
                f'{self.duration:.2f}s' if self.duration else '',
                f'{self.rate} Hz' if self.rate else '',
                str(self.channels) if self.channels else '',
                str(self.dr) if self.dr is not None else '',
                f'{self.lufs:.2f}' if self.lufs is not None else '',
                f'{self.peak:+.2f}' if self.peak is not None else '',
                self.authenticity,self.codec,self.detail]


def analyze_one(path, do_dr, do_auth, ff, fp, stop):
    import numpy as np
    r=Result(str(path),status='Running')
    try:
        if stop.is_set():raise InterruptedError('Cancelled')
        info=probe_audio(Path(path),ff,fp)
        r.rate=info['rate'];r.channels=info['channels'];r.duration=info['duration'];r.codec=info['codec']
        if r.channels<1 or r.channels>32:raise ValueError('Unsupported channel count')
        with tempfile.TemporaryDirectory(prefix='audio-suite-',dir=str(ensure_dirs()/'temp')) as tmp:
            pcm_path=Path(tmp)/'decoded.f32'
            spawn_decode(Path(path),pcm_path,info,ff,stop)
            samples=pcm_path.stat().st_size//(r.channels*4)
            if samples<=0:raise ValueError('No decoded samples')
            r.duration=samples/r.rate
            audio=np.memmap(pcm_path,dtype='<f4',mode='r',shape=(samples,r.channels))
            if do_dr:
                if r.duration<10:
                    r.detail='DR rejected: shorter than 10 seconds'
                    if not do_auth:
                        r.status='Rejected'
                        del audio
                        return r
                else:
                    r.dr=pmf_estimate(audio,r.rate,stop)
                r.lufs=round(loudness(audio,r.rate,stop),2) if r.duration>=.4 else -128.0
                r.peak=round(true_peak(audio,r.rate,stop),2)
            if do_auth:
                r.authenticity,msg=authenticity(audio,r.rate,r.codec,stop)
                r.detail=(r.detail+'; ' if r.detail else '')+msg
            del audio
        r.status='Done'
    except InterruptedError:
        r.status='Cancelled';r.detail='Cancelled'
    except Exception as exc:
        r.status='Error';r.detail=str(exc)[:400]
    return r


def save_report(results, dest):
    dest=Path(dest)
    fields=[HEADERS[0],'Path',*HEADERS[1:]]
    rows=[[r.cells()[0],r.path,*r.cells()[1:]] for r in results]
    if dest.suffix.lower()=='.tsv':
        with dest.open('w',encoding='utf-8',newline='') as fh:
            writer=csv.writer(fh,delimiter='\t',lineterminator='\r\n')
            writer.writerow(fields)
            writer.writerows(rows)
    else:
        with dest.open('w',encoding='utf-8',newline='\r\n') as fh:
            fh.write(f'{PRODUCT} v{VERSION} - Experimental report\n')
            fh.write('Measurements are not validated as DROffline or AudioChecker equivalent.\n\n')
            for row in rows:
                fh.write('\n'.join(f'{key}: {value}' for key,value in zip(fields,row))+'\n\n')
    return dest


def load_settings():
    try:
        return json.loads((ensure_dirs()/'settings'/'settings.json').read_text(encoding='utf-8'))
    except (ValueError,OSError):return {}


def write_settings(data):
    d=ensure_dirs()/'settings'
    tmp=d/('settings-'+uuid.uuid4().hex+'.tmp')
    tmp.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
    tmp.replace(d/'settings.json')


def run_headless(paths, do_dr=True, do_auth=True, workers=2, export=None):
    require_packages(gui=False)
    ff,fp=ffmpeg_paths()
    stop=threading.Event()
    collected={}
    with ThreadPoolExecutor(max_workers=max(1,workers)) as pool:
        futures={pool.submit(analyze_one,p,do_dr,do_auth,ff,fp,stop):i for i,p in enumerate(paths)}
        for fut in as_completed(futures):
            r=fut.result()
            collected[futures[fut]]=r
            print(json.dumps(asdict(r),ensure_ascii=False))
    results=[collected[i] for i in range(len(paths))]
    if export:save_report(results,export)
    return 1 if any(r.status=='Error' for r in results) else 0


def gui_main():
    require_packages(gui=True)
    from PySide6.QtCore import QAbstractTableModel,QModelIndex,Qt,QObject,QThread,Signal,QSettings
    from PySide6.QtGui import QAction,QKeySequence,QColor
    from PySide6.QtWidgets import (QApplication,QMainWindow,QWidget,QVBoxLayout,QHBoxLayout,
        QPushButton,QCheckBox,QSpinBox,QLabel,QTableView,QFileDialog,QMessageBox,
        QHeaderView,QAbstractItemView,QStyle,QStatusBar,QMenu)

    class Model(QAbstractTableModel):
        def __init__(self):super().__init__();self.rows=[]
        def rowCount(self,parent=QModelIndex()):return 0 if parent.isValid() else len(self.rows)
        def columnCount(self,parent=QModelIndex()):return len(HEADERS)
        def data(self,index,role=Qt.DisplayRole):
            if not index.isValid():return None
            r=self.rows[index.row()]
            if role==Qt.DisplayRole:
                return r.cells()[index.column()]
            if role==Qt.ToolTipRole:
                return r.path if index.column()==0 else r.detail
            if role==Qt.ForegroundRole and index.column()==1:
                return QColor('#ED7878' if r.status=='Error' else '#70C9A0' if r.status=='Done' else '#BAC4D2')
            return None
        def headerData(self,section,orientation,role=Qt.DisplayRole):
            if role==Qt.DisplayRole and orientation==Qt.Horizontal:return HEADERS[section]
            return None
        def append_paths(self,paths):
            present={r.path.casefold() for r in self.rows}
            new=[]
            for path in paths:
                p=str(Path(path).resolve())
                if p.casefold() not in present and Path(p).is_file():
                    present.add(p.casefold());new.append(Result(p))
            if new:
                a=len(self.rows);self.beginInsertRows(QModelIndex(),a,a+len(new)-1)
                self.rows.extend(new);self.endInsertRows()
            return len(new)
        def update_row(self,row,result):
            self.rows[row]=result
            self.dataChanged.emit(self.index(row,0),self.index(row,len(HEADERS)-1),
                                  [Qt.DisplayRole,Qt.ToolTipRole,Qt.ForegroundRole])
        def remove_rows(self,indices):
            for i in sorted(set(indices),reverse=True):
                self.beginRemoveRows(QModelIndex(),i,i)
                self.rows.pop(i);self.endRemoveRows()

    class Runner(QThread):
        completed=Signal(int,object)
        started_file=Signal(int)
        message=Signal(str)
        def __init__(self,queued,do_dr,do_auth,workers):
            super().__init__()
            self.queued=queued;self.do_dr=do_dr;self.do_auth=do_auth
            self.workers=workers;self.stop_event=threading.Event()
        def run(self):
            try:
                ff,fp=ffmpeg_paths()
                with ThreadPoolExecutor(max_workers=self.workers) as pool:
                    futures={}
                    for i,p in self.queued:
                        if self.stop_event.is_set():break
                        futures[pool.submit(analyze_one,p,self.do_dr,self.do_auth,ff,fp,self.stop_event)]=i
                        self.started_file.emit(i)
                    for fut in as_completed(futures):
                        i=futures[fut]
                        try:r=fut.result()
                        except Exception as ex:r=Result(self.queued[i][1],status='Error',detail=str(ex))
                        self.completed.emit(i,r)
            except Exception as exc:
                self.message.emit(str(exc))
        def cancel(self):self.stop_event.set()

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle(f'{PRODUCT} v{VERSION} - Under construction ⚠️')
            self.resize(1110,610)
            self.setMinimumSize(750,400)
            self.setAcceptDrops(True)
            self.model=Model()
            self.runner=None
            self.started_count=0;self.done_count=0
            self.logfile=None
            cfg=load_settings()
            outer=QWidget();self.setCentralWidget(outer)
            layout=QVBoxLayout(outer);layout.setContentsMargins(12,12,12,8);layout.setSpacing(8)
            controls=QHBoxLayout();controls.setSpacing(7);layout.addLayout(controls)
            self.add_files=QPushButton('Add files');self.add_files.clicked.connect(self.pick_files)
            self.add_folder=QPushButton('Add folder');self.add_folder.clicked.connect(self.pick_folder)
            self.dr=QCheckBox('DR / Loudness');self.dr.setChecked(cfg.get('dr',True))
            self.auth=QCheckBox('Authenticity');self.auth.setChecked(cfg.get('auth',True))
            self.workers=QSpinBox();self.workers.setRange(1,max(1,os.cpu_count() or 1))
            self.workers.setValue(max(1,min(int(cfg.get('workers',min(4,os.cpu_count() or 1))),self.workers.maximum())))
            self.workers.setToolTip('Concurrent audio files')
            self.run_button=QPushButton('Analyze');self.run_button.setObjectName('primary')
            self.run_button.clicked.connect(self.toggle_run)
            self.export_button=QPushButton('Export');self.export_button.clicked.connect(self.export)
            for item in (self.add_files,self.add_folder,self.dr,self.auth,QLabel('Workers'),self.workers):
                controls.addWidget(item)
            controls.addStretch(1);controls.addWidget(self.export_button);controls.addWidget(self.run_button)
            self.table=QTableView();self.table.setModel(self.model)
            self.table.setSortingEnabled(False)
            self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
            self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
            self.table.setAlternatingRowColors(True)
            self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
            self.table.verticalHeader().hide()
            self.table.verticalHeader().setDefaultSectionSize(29)
            h=self.table.horizontalHeader();h.setSectionResizeMode(QHeaderView.Interactive)
            h.setStretchLastSection(True)
            for col,width in enumerate([245,82,90,95,72,135,127,128,175,85,250]):
                self.table.setColumnWidth(col,width)
            self.table.doubleClicked.connect(self.reveal)
            layout.addWidget(self.table,1)
            self.status=QLabel('0 files')
            layout.addWidget(self.status)
            self.export_button.setEnabled(False)
            self.dr.toggled.connect(self.refresh_controls)
            self.auth.toggled.connect(self.refresh_controls)
            for keys,action in [('Ctrl+O',self.pick_files),('Ctrl+Shift+O',self.pick_folder),
                                ('Ctrl+S',self.export),('Delete',self.remove_selected)]:
                sc=QAction(self);sc.setShortcut(QKeySequence(keys));sc.triggered.connect(action);self.addAction(sc)
            self.setStyleSheet('''
                QMainWindow,QWidget {background:#15191f;color:#e5ebf2;font:12px "Segoe UI";}
                QPushButton {background:#29313d;border:1px solid #3a4654;border-radius:5px;
                    padding:6px 12px;min-height:20px;}
                QPushButton:hover {background:#374355;border-color:#63718a;}
                QPushButton:pressed {background:#233041;}
                QPushButton:disabled {color:#748093;background:#242a32;border-color:#303744;}
                QPushButton#primary {background:#2463a1;border-color:#397fc0;font-weight:600;}
                QPushButton#primary:hover {background:#3179bb;}
                QCheckBox {spacing:5px;}
                QSpinBox {background:#232c36;border:1px solid #445064;border-radius:4px;
                    padding:4px;min-width:45px;}
                QTableView {background:#191f28;alternate-background-color:#202731;
                    border:1px solid #394452;gridline-color:#303b47;selection-background-color:#274969;}
                QHeaderView::section {background:#252e39;color:#b9c9d8;padding:5px;
                    border:0;border-right:1px solid #384353;}
                QLabel {color:#aebccc;}
            ''')
            self.refresh_controls()
        def selected_rows(self):return sorted({x.row() for x in self.table.selectionModel().selectedRows()})
        def reveal(self,index):
            if not index.isValid():return
            path=self.model.rows[index.row()].path
            try:
                if os.name=='nt': subprocess.Popen(['explorer.exe','/select,',str(path)])
                elif sys.platform=='darwin': subprocess.Popen(['open','-R',path])
                else:subprocess.Popen(['xdg-open',str(Path(path).parent)])
            except OSError as exc:QMessageBox.warning(self,'Open location',str(exc))
        def pick_files(self):
            files,_=QFileDialog.getOpenFileNames(self,'Add audio',load_settings().get('browse',''),
                                                  'Audio files (*);;All files (*)')
            self.add_sources(files)
        def pick_folder(self):
            folder=QFileDialog.getExistingDirectory(self,'Add audio folder',load_settings().get('browse',''))
            if folder:self.add_sources([folder])
        def add_sources(self,paths):
            if self.runner and self.runner.isRunning():return
            found=[]
            for p in paths:
                p=Path(p)
                if p.is_dir():
                    try:found.extend(str(x) for x in p.rglob('*') if x.is_file() and x.suffix.lower() in EXTENSIONS)
                    except OSError:continue
                elif p.is_file():found.append(str(p))
            count=self.model.append_paths(found)
            if paths:write_settings(self.settings_dict(browse=str(Path(paths[0]).parent)))
            self.refresh_controls()
            self.status.setText(f'{len(self.model.rows)} files (+{count})')
        def dragEnterEvent(self,e):
            if e.mimeData().hasUrls() and (not self.runner or not self.runner.isRunning()):e.acceptProposedAction()
        def dropEvent(self,e):
            self.add_sources([u.toLocalFile() for u in e.mimeData().urls() if u.isLocalFile()]);e.acceptProposedAction()
        def remove_selected(self):
            if self.runner and self.runner.isRunning():return
            self.model.remove_rows(self.selected_rows());self.refresh_controls()
            self.status.setText(f'{len(self.model.rows)} files')
        def settings_dict(self,browse=None):
            old=load_settings()
            return {'dr':self.dr.isChecked(),'auth':self.auth.isChecked(),
                    'workers':self.workers.value(),'browse':browse or old.get('browse','')}
        def refresh_controls(self):
            busy=self.runner is not None and self.runner.isRunning()
            ready=bool(self.model.rows) and (self.dr.isChecked() or self.auth.isChecked())
            self.run_button.setEnabled(busy or ready)
            self.export_button.setEnabled(not busy and any(r.status=='Done' for r in self.model.rows))
            for ctl in (self.add_files,self.add_folder,self.dr,self.auth,self.workers):ctl.setEnabled(not busy)
            self.run_button.setText('Stop' if busy else 'Analyze')
        def log(self,line):
            if self.logfile:
                try:
                    with self.logfile.open('a',encoding='utf-8') as f:
                        f.write(f'{dt.datetime.now().isoformat(timespec="seconds")} {line}\n')
                except OSError as exc:
                    self.logfile=None
                    QMessageBox.critical(self,'Logging error',str(exc))
        def toggle_run(self):
            if self.runner and self.runner.isRunning():
                self.runner.cancel();self.run_button.setEnabled(False)
                self.status.setText('Stopping...');self.log('Cancellation requested')
                return
            queue=[(i,r.path) for i,r in enumerate(self.model.rows)]
            if not queue or not (self.dr.isChecked() or self.auth.isChecked()):return
            try:self.logfile=log_path('run')
            except OSError as exc:
                QMessageBox.critical(self,'Logging error',str(exc));return
            write_settings(self.settings_dict())
            self.done_count=0;self.started_count=len(queue)
            self.log(f'Start: {len(queue)} files; workers={self.workers.value()}')
            self.runner=Runner(queue,self.dr.isChecked(),self.auth.isChecked(),self.workers.value())
            self.runner.completed.connect(self.on_result)
            self.runner.message.connect(self.on_error)
            self.runner.finished.connect(self.on_finished)
            self.runner.start()
            self.refresh_controls()
            self.status.setText(f'0 / {len(queue)} completed')
        def on_result(self,i,r):
            self.model.update_row(i,r);self.done_count+=1
            self.log(f'{r.status}: {r.path} | DR={r.dr} LUFS={r.lufs} TP={r.peak} Auth={r.authenticity} {r.detail}')
            self.status.setText(f'{self.done_count} / {self.started_count} completed')
        def on_error(self,msg):
            self.log('ERROR '+msg)
            QMessageBox.critical(self,'Analysis error',msg)
        def on_finished(self):
            cancelled=self.runner.stop_event.is_set()
            self.log('Cancelled' if cancelled else 'Completed')
            self.runner=None
            self.refresh_controls()
            failed=sum(r.status=='Error' for r in self.model.rows)
            self.status.setText(f'{self.done_count} / {self.started_count} completed' +
                (f' · {failed} errors' if failed else '') + (' · stopped' if cancelled else ''))
        def export(self):
            results=[r for r in self.model.rows if r.status=='Done']
            if not results:return
            filename,_=QFileDialog.getSaveFileName(self,'Export analysis',str(Path.home()/'Audio_Analysis.txt'),
                                                   'Text report (*.txt);;TSV (*.tsv)')
            if not filename:return
            try:
                save_report(results,filename)
                self.status.setText(f'Exported {len(results)} results: {filename}')
            except OSError as exc:QMessageBox.critical(self,'Export failed',str(exc))
        def closeEvent(self,e):
            if self.runner and self.runner.isRunning():
                self.runner.cancel();self.runner.wait(15000)
                if self.runner.isRunning():
                    e.ignore();self.status.setText('Stopping active decoder before closing...');return
            try:write_settings(self.settings_dict())
            except OSError:pass
            super().closeEvent(e)
    app=QApplication(sys.argv)
    app.setStyle('Fusion')
    win=Window();win.show()
    return app.exec()


def main():
    if '--headless' in sys.argv:
        import argparse
        parser=argparse.ArgumentParser()
        parser.add_argument('--headless',action='store_true')
        parser.add_argument('--dr',action='store_true')
        parser.add_argument('--auth',action='store_true')
        parser.add_argument('--workers',type=int,default=2)
        parser.add_argument('--output')
        parser.add_argument('files',nargs='+')
        a=parser.parse_args()
        return run_headless(a.files,a.dr or not a.auth,a.auth or not a.dr,a.workers,a.output)
    try:return gui_main()
    except Exception as exc:
        message=f'{exc}\n\n{traceback.format_exc()[-2000:]}'
        try:
            path=log_path('startup')
            path.write_text(message,encoding='utf-8')
        except Exception:pass
        if os.name=='nt':
            import ctypes
            ctypes.windll.user32.MessageBoxW(0,message[:2500],'Audio Analysis Suite - Startup error',0x10)
        else:print(message,file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
