import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatReactionCount } from '../public/reactions.mjs';
import { createReception, receiveReactions, advanceReception, receptionDeadline, resumeReception,
  RECEPTION_PARTICLE_COUNT } from './reaction-reception.mjs';

const ease = node => getComputedStyle(node).getPropertyValue('--ease-out').trim() || 'cubic-bezier(.23,1,.32,1)';
const continueAnimation = animation => {
  if (!animation || animation.playState === 'finished' || animation.playState === 'idle') return;
  const timing = animation.effect?.getComputedTiming?.();
  if (timing?.endTime != null && Number(animation.currentTime) >= Number(timing.endTime)) return;
  animation.play();
};

function EmojiWave({ palette, visible, celebration }) {
  const ref = useRef(null), animations = useRef([]);
  useLayoutEffect(() => {
    const width = innerWidth, height = innerHeight;
    animations.current = [...ref.current.children].map((node,index) => {
      // Fixed, staggered trajectories fill the viewport without adding one DOM
      // node per tap. Every moving frame changes only transform and opacity.
      const column = index%4, row = Math.floor(index/4);
      const x = (column+.35+(row%2)*.27)*width/4;
      const y = (row+.25)*height/8;
      const spin = (index%2 ? 1 : -1)*(10+(index*13)%28);
      const startX = width/2+Math.sin(index*2.4)*28;
      const startY = height*.45+Math.cos(index*1.7)*22;
      const pose = (px,py,scale,angle) => `translate3d(${px}px,${py}px,0) translate(-50%,-50%) rotate(${angle}deg) scale(${scale})`;
      return node.animate([
        { transform:pose(startX,startY,.92,-spin),opacity:0,offset:0 },
        { transform:pose(x,y,1.08,spin),opacity:1,offset:.22 },
        { transform:pose(x+Math.sin(index)*16,y-26,1,spin*.7),opacity:1,offset:.68 },
        { transform:pose(x+Math.sin(index)*24,y-70,.96,spin*.9),opacity:0,offset:1 },
      ].map(frame => ({ ...frame,easing:ease(node) })),{
        duration:2100,delay:(index%6)*48,fill:'both',
      });
    });
    return () => { animations.current.forEach(animation => animation.cancel()); };
  }, [celebration]);
  useEffect(() => { animations.current.forEach(animation => visible ? continueAnimation(animation) : animation.pause()); }, [visible,celebration]);
  return <div ref={ref} className="emoji-celebration-wave" aria-hidden="true">
    {Array.from({length:RECEPTION_PARTICLE_COUNT},(_,index) => <span className="emoji-celebration-particle" key={index}
      style={{fontSize:`${48+(index*17)%58}px`}}>{palette.filter((_,item) => item%RECEPTION_PARTICLE_COUNT === index).join('') || palette[index%palette.length]}</span>)}
  </div>;
}

export default function ReactionReception({ events, visible, onSeen, onFinish }) {
  const [state,setState] = useState(createReception);
  const focus = useRef(null), glyph = useRef(null), movement = useRef(null), pulse = useRef(null);
  const callbacks = useRef({onSeen,onFinish}), consumed = useRef(0), hiddenAt = useRef(null);
  const previousPhase = useRef(null), lastCount = useRef(null);
  callbacks.current = {onSeen,onFinish};
  const view = state.view, primary = view?.groups[0];

  useLayoutEffect(() => {
    const now = Date.now();
    if (!visible) { hiddenAt.current ??= now; return; }
    const elapsed = hiddenAt.current === null ? 0 : now-hiddenAt.current;
    hiddenAt.current = null;
    // Rebase the pre-hide scene before accepting an in-flight response. A new
    // scene must not inherit time spent in the background as extra play time.
    if (elapsed || events.length) setState(current => {
      const resumed = resumeReception(current,elapsed);
      return events.length ? receiveReactions(resumed,events,now) : resumed;
    });
  }, [events,visible]);

  // Acknowledge actual IDs only after the scene has been rendered. Reading a
  // cumulative burstCount must never acknowledge a page we have not fetched.
  useEffect(() => {
    if (!visible || consumed.current === state.sequence) return;
    const ids = view?.receiptIds || state.consumedIds || [];
    let paint, receipt;
    paint = requestAnimationFrame(() => {
      receipt = requestAnimationFrame(() => {
        if (document.visibilityState === 'hidden') return;
        consumed.current = state.sequence;
        if (ids.length) {
          ids.forEach(id => callbacks.current.onSeen({id}));
          callbacks.current.onFinish(ids);
        }
      });
    });
    return () => { cancelAnimationFrame(paint); cancelAnimationFrame(receipt); };
  }, [visible,state.sequence,view?.receiptIds,state.consumedIds]);

  useEffect(() => {
    if (!visible) return;
    const deadline = receptionDeadline(state);
    if (deadline === null) return;
    const timer = setTimeout(() => setState(current => advanceReception(current,Date.now())),Math.max(0,deadline-Date.now()));
    return () => clearTimeout(timer);
  }, [state,visible]);

  useLayoutEffect(() => {
    const node = focus.current;
    if (!node || !view) { previousPhase.current = null; lastCount.current = null; return; }
    const style = getComputedStyle(node), oldPhase = previousPhase.current;
    const current = {transform:style.transform === 'none' ? 'translate3d(0,56px,0) scale(.56) rotate(-8deg)' : style.transform,opacity:oldPhase ? Number(style.opacity) : 0};
    movement.current?.cancel();
    const scale = view.phase === 'flood' ? 1 : .64;
    const dockX = innerWidth/2-66, dockY = -innerHeight*.45+94;
    const dockPose = `translate3d(${dockX}px,${dockY}px,0) scale(.24) rotate(0deg)`;
    const frames = view.phase === 'dock' ? [current,{transform:dockPose,opacity:0}]
      : view.phase === 'exit' ? [current,{transform:`${style.transform === 'none' ? 'scale(1)' : style.transform} translateY(14px)`,opacity:0}]
      : [current,
        {transform:`translate3d(0,-9px,0) scale(${scale*1.085},${scale*.955}) rotate(3deg)`,opacity:1,offset:.58},
        {transform:`translate3d(0,3px,0) scale(${scale*.985},${scale*1.025}) rotate(-1deg)`,opacity:1,offset:.8},
        {transform:`translate3d(0,0,0) scale(${scale}) rotate(0deg)`,opacity:1,offset:1}];
    movement.current = node.animate(frames,{duration:view.phase === 'exit' ? 240 : view.phase === 'dock' ? 280 : 500,easing:ease(node),fill:'both'});
    if (!visible) movement.current.pause();
    previousPhase.current = view.phase;
  }, [view?.phase,view?.celebration,Boolean(view)]);

  useLayoutEffect(() => {
    if (!glyph.current || !primary) return;
    const signature = `${primary.id}:${primary.count}`;
    if (lastCount.current && signature !== lastCount.current && view.phase !== 'exit') {
      const node = glyph.current, transform = getComputedStyle(node).transform;
      pulse.current?.cancel();
      pulse.current = node.animate([
        {transform:transform === 'none' ? 'scale(1)' : transform},
        {transform:'scale(1.08,.96) rotate(-2deg)',offset:.45},
        {transform:'scale(1) rotate(0deg)'},
      ],{duration:240,easing:ease(node)});
    }
    lastCount.current = signature;
  }, [primary?.id,primary?.count]);
  useEffect(() => {
    for (const animation of [movement.current,pulse.current]) visible ? continueAnimation(animation) : animation?.pause();
  }, [visible]);
  useEffect(() => () => { movement.current?.cancel(); pulse.current?.cancel(); }, []);

  if (!view || !primary) return null;
  return <div className="incoming-emoji emoji-reception" aria-hidden="true" data-burst-id={primary.id}
    data-reaction-count={primary.count} data-phase={view.phase} data-celebration-id={view.celebration || undefined}>
    {view.phase === 'flood' && <EmojiWave palette={view.palette} celebration={view.celebration} visible={visible}/>}
    <div className="emoji-reception-focus" ref={focus}>
      <span className="incoming-emoji-glyph" ref={glyph}>{primary.emoji}</span>
      {primary.count > 1 && <span className="emoji-burst-count">{formatReactionCount(primary.count)}</span>}
    </div>
    <div className="emoji-reception-dock">
      {view.groups.map(group => <span className="emoji-reception-combo" key={group.id}>
        <span className="emoji-reception-mini">{group.emoji}</span>
        {group.count > 1 && <span className="emoji-burst-count">{formatReactionCount(group.count)}</span>}
      </span>)}
    </div>
  </div>;
}
