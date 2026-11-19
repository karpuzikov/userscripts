import json, sys, math
rows = json.load(open(sys.argv[1], encoding='utf-8'))
def tp(v): return 'N/A' if v is None else (f'{v:+.2f}' if math.copysign(1,v)>0 else f'{v:.2f}')
def lu(v): return 'N/A' if v is None else f'{v:.2f}'
def dr(v): return 'N/A' if v is None else str(int(round(v)))  # python round == half-even
out=[]
for r in rows:
    g=r.get('golden')
    if not g:
        out.append(dict(file=r['file'],golden=None,app_status=r['app_status'],detail=r['app_detail'],dur=round(r['duration_s'],4))); continue
    e=dict(file=r['file'])
    for k,gk,fmt,ak,mk in (('TPL','max_tpl_display',tp,'app_tp','model_tp'),('LUFSi','lufsi_display',lu,'app_lufs','model_lufs'),
                           ('DR','dr_display',dr,'app_dr','model_dr_partial')):
        a=fmt(r.get(ak)); m=fmt(r.get(mk)); gv=g[gk]
        e[k]=dict(golden=gv,app=a,app_ok=a==gv,model=m,model_ok=m==gv,model_raw=r.get(mk))
    e['DR']['model_full_only']=dr(r.get('model_dr_full_only')); e['DR']['model_full_only_raw']=r.get('model_dr_full_only')
    out.append(e)
json.dump(out,open(sys.argv[2],'w',encoding='utf-8'),indent=1,ensure_ascii=False)
for e in out:
    if 'TPL' not in e: print('REJECT/NOGOLD',e); continue
    print(f"{e['file'][:28]:28} TPL g{e['TPL']['golden']:>8} a{e['TPL']['app']:>8} m{e['TPL']['model']:>8} | LUFS g{e['LUFSi']['golden']:>8} a{e['LUFSi']['app']:>8} m{e['LUFSi']['model']:>8} | DR g{e['DR']['golden']:>3} a{e['DR']['app']:>3} m{e['DR']['model']:>3} mfull{e['DR']['model_full_only']:>3} raw={e['DR']['model_raw']:.3f}")
for k in ('TPL','LUFSi','DR'):
    xs=[e for e in out if k in e]
    print(k,'app match',sum(e[k]['app_ok'] for e in xs),'/',len(xs),' model match',sum(e[k]['model_ok'] for e in xs),'/',len(xs))
xs=[e for e in out if 'DR' in e]; print('DR full-only model match',sum(e['DR']['model_full_only']==e['DR']['golden'] for e in xs))
