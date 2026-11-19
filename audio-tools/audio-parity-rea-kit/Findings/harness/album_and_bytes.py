import json, sys, math, numpy as np
rows=json.load(open(sys.argv[1],encoding='utf-8'))
acc=[r for r in rows if r.get('golden')]
raw=[r['model_dr_partial'] for r in acc]
mean=sum(raw)/len(raw)
print('album model: mean unrounded composite =',round(mean,4),'-> round_half_even =',int(np.rint(mean)))
ints=[r['app_dr'] for r in acc]; am=sum(ints)/len(ints)
print('app experimental: mean of rounded ints =',round(am,4),'-> floor(x+0.5) =',math.floor(am+0.5))
ref=open(sys.argv[2],'rb').read(); app=open(sys.argv[3],'rb').read()
print('reference bytes',len(ref),'app bytes',len(app),'identical',ref==app)
rl=ref.decode('utf-8').split('\r\n'); al=app.decode('utf-8').split('\r\n')
for i in range(max(len(rl),len(al))):
    a=rl[i] if i<len(rl) else '<none>'; b=al[i] if i<len(al) else '<none>'
    if a!=b: print(f'L{i+1:02}\n  ref: {a!r}\n  app: {b!r}')
