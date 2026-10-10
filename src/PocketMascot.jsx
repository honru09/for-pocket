import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tappable } from '@telegram-apps/telegram-ui';
import { createPortal } from 'react-dom';

const BODY = 'M24 53C16 18 48 7 68 18C86-1 121 23 107 52C130 74 113 107 87 101C70 128 38 116 35 98C4 105-5 68 24 53Z';
const MOODS = ['cloudHappy', 'cloudSmile', 'cloudShy', 'cloudQuestion', 'cloudSigh', 'cloudGrumpy', 'cloudFurious'];
const EYES = ['M45 58v7m28-10v7', 'M39 63q6-9 12 0m18-2q6-9 12 0', 'M40 63q5-6 10 0m20-2q5-6 10 0', 'M45 58v7m28-10v7', 'M40 61h12m18-2h12', 'M45 62v5m29-7v5', 'M41 58l10 5-9 3m39-10-10 5 9 3'];
const MOUTHS = ['M50 78q10 10 20-3', 'M50 78q10 10 20-3', 'M56 79q5 5 10-1', 'M60 79a3 4 0 1 0 6 0a3 4 0 1 0-6 0', 'M56 83q7-3 13-1', 'M54 84q9-9 17-2', 'M52 81q12-7 23-2l-2 10q-12 5-20-1Z'];

function Cloud({ mood }) {
  return <svg className="mascot" id="mascot" viewBox="0 0 130 126" aria-hidden="true">
    <path className="mascot-body" d={BODY}/>
    <g className="cloud-face-idle">
      <g className="cloud-face">
      {mood >= 5 && <path className="cloud-brows" d={mood === 6 ? 'M39 48l15 8m30-10-16 9' : 'M40 51l13 5m29-7-12 5'}/>}
      <g className="cloud-eyes"><path d={EYES[mood]} className="face-eyes"/></g>
      <path d={MOUTHS[mood]} className={`face-mouth ${mood === 6 ? 'cloud-angry-mouth' : ''}`}/>
      <ellipse className="cloud-blush" cx="35" cy="74" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
      <ellipse className="cloud-blush" cx="88" cy="72" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
      {mood === 2 && <g className="cloud-blush-lines"><path d="m30 72 2 4m3-5 2 4m45-5 2 4m3-5 2 4"/></g>}
      </g>
    </g>
    {mood === 3 && <text className="cloud-question" x="101" y="32">?</text>}
    {mood === 4 && <><path className="cloud-sigh" d="M89 83q12-11 19-4q4 7-4 9q-8 1-9-3m11-12q8-2 9 5"/><path className="cloud-teardrop" d="M92 54q5 7 0 11q-5-4 0-11Z"/></>}
    {mood >= 5 && <path className="cloud-vein" d="M94 34v5h-5m9-1v6h6"/>}
    {mood === 6 && <g className="cloud-steam"><path d="M24 33q-9-6-4-12m79 3q10-6 6-13"/><path className="cloud-spark" d="m20 47 3 2m-1-5-1 4m91 5 3-2m-1 5-1-4"/></g>}
  </svg>;
}

function StopSign() {
  return <svg className="cloud-stop-sign" viewBox="0 0 130 126" aria-hidden="true">
    <ellipse cx="65" cy="120" rx="22" ry="3" fill="#b9c4a2" opacity=".5"/>
    <path d="M65 55v64" stroke="#938f79" strokeWidth="7" strokeLinecap="round"/>
    <path d="M65 59v59" stroke="#c5c3b2" strokeWidth="3" strokeLinecap="round"/>
    <path d="M15 15h100L65 94Z" fill="#cf6657" stroke="#fff9ed" strokeWidth="6" strokeLinejoin="round"/>
    <path d="M22 20h86L65 87Z" fill="none" stroke="#b45043" strokeWidth="1.5" strokeLinejoin="round"/>
    <text x="65" y="47" textAnchor="middle" fill="#fff9ed" fontSize="20" fontWeight="800" fontFamily="'Yu Gothic','Hiragino Kaku Gothic ProN','Microsoft YaHei',sans-serif">止まれ</text>
  </svg>;
}

export default function PocketMascot({ mascotRef, t, onTap }) {
  const [step, setStep] = useState(0), [phase, setPhase] = useState('cloud');
  const [signTaps, setSignTaps] = useState(0), [flight, setFlight] = useState(null);
  const stepRef = useRef(0), tapsRef = useRef(0), buttonRef = useRef(null), flightRef = useRef(null);
  const motionRef = useRef(null), deadlineRef = useRef(0), lastPhase = useRef('cloud');
  const reset = useCallback(() => {
    stepRef.current = 0; tapsRef.current = 0;
    setStep(0); setSignTaps(0); setFlight(null); setPhase('cloud');
  }, []);

  // One deadline from the seventh tap. Rerenders and the landing do not restart it.
  useEffect(() => {
    if (step !== 7) return;
    const landing = setTimeout(() => setPhase('falling'), 280);
    const restore = setTimeout(reset, Math.max(0, deadlineRef.current - Date.now()));
    return () => { clearTimeout(landing); clearTimeout(restore); };
  }, [step, reset]);

  useLayoutEffect(() => {
    if (phase !== 'falling') return;
    const rect = buttonRef.current.getBoundingClientRect();
    setFlight({ left:rect.left, top:rect.top, width:rect.width, height:rect.height });
  }, [phase]);

  useEffect(() => {
    if (!flight || phase !== 'falling') return;
    const animation = flightRef.current.animate([
      { transform:`translateY(${-flight.top - flight.height - 24}px) rotate(-5deg)` },
      { transform:'translateY(3px) rotate(2deg)', offset:.8 },
      { transform:'translateY(-2px) rotate(-1deg)', offset:.94 },
      { transform:'translateY(0) rotate(0)' },
    ], { duration:500, easing:getComputedStyle(buttonRef.current).getPropertyValue('--ease-out').trim(), fill:'both' });
    let cancelled = false;
    animation.finished.then(() => { if (!cancelled) { setPhase('sign'); setFlight(null); } }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [flight, phase]);

  useLayoutEffect(() => {
    const returning = phase === 'cloud' && lastPhase.current !== 'cloud';
    lastPhase.current = phase;
    if (!returning) return;
    const animation = motionRef.current?.animate([{ opacity:0, transform:'rotate(-8deg) scale(.94)' }, { opacity:1, transform:'rotate(-8deg) scale(1)' }], { duration:240, easing:getComputedStyle(buttonRef.current).getPropertyValue('--ease-out').trim() });
    return () => animation?.cancel();
  }, [phase]);

  const tap = () => {
    if (phase === 'burst' || phase === 'falling') return;
    onTap?.();
    if (phase === 'sign') {
      const next = ++tapsRef.current;
      if (next === 2) reset(); else setSignTaps(next);
      return;
    }
    const next = Math.min(7, ++stepRef.current);
    setStep(next);
    if (next === 7) { deadlineRef.current = Date.now() + 7000; setPhase('burst'); }
  };
  const sign = phase === 'sign' || phase === 'falling';
  const moodKey = step === 7 ? 'cloudPopped' : MOODS[step];
  const label = sign ? t(signTaps ? 'cloudRestoreAgain' : 'cloudRestore') : t('cloudTap', { mood:t(moodKey) });
  return <>
    <Tappable Component="button" type="button" interactiveAnimation="opacity" ref={buttonRef} className="mascot-toy" data-phase={phase} data-mood={Math.min(step,6)} data-sign-taps={signTaps} aria-label={label} aria-disabled={phase === 'burst' || phase === 'falling'} onClick={tap}>
      {!sign && <span ref={node => { motionRef.current = node; }} className="cloud-motion"><span ref={node => { if (mascotRef) mascotRef.current = node; }} className="cloud-touch"><span className="cloud-shell"><Cloud mood={Math.min(step,6)}/></span></span></span>}
      {phase === 'burst' && <span className="cloud-pop" aria-hidden="true"><span className="cloud-pop-word">{t('cloudPopSound')}</span>{Array.from({length:6},(_,i) => <i key={i} style={{ '--puff-x':`${Math.cos(i * Math.PI / 3) * 32}px`, '--puff-y':`${Math.sin(i * Math.PI / 3) * 27}px` }}/>)}</span>}
      {sign && <span className="stop-sign-rest" data-hidden={phase === 'falling'}><StopSign/></span>}
    </Tappable>
    <span className="cloud-announcement" role="status" aria-live="polite">{step ? t(moodKey) : ''}</span>
    {flight && phase === 'falling' && createPortal(<span ref={flightRef} className="cloud-sign-flight" style={flight}><StopSign/></span>,document.body)}
  </>;
}

