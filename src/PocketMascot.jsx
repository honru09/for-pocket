import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tappable } from '@telegram-apps/telegram-ui';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import weatherAtlas from '../public/assets/weather-accessories-v2.png';
import confirmButtonAtlas from '../public/assets/confirm-button-atlas.png';
import mainCloudAsset from '../public/assets/mascot-main.png';
import mascotExpressionsAtlas from '../public/assets/mascot/mascot-expressions-atlas-v1.png';
import mascotTapAtlas from '../public/assets/mascot/mascot-tap-frames-v1.png';
import mascotCashAtlas from '../public/assets/mascot/mascot-cash-frames-v1.png';
import MorphFacePath from './MorphFacePath.jsx';
import { EYE_POSES, MOUTH_POSES, SLEEP_EYES } from './mascot-face.mjs';

const BODY = 'M24 53C16 18 48 7 68 18C86-1 121 23 107 52C130 74 113 107 87 101C70 128 38 116 35 98C4 105-5 68 24 53Z';
const MOODS = ['cloudHappy', 'cloudSmile', 'cloudShy', 'cloudQuestion', 'cloudSigh', 'cloudGrumpy', 'cloudFurious'];
const CASH_DURATION = { expense: 860, income: 1040 };
const TEAR = 'M0-5C-2-2-4 0-4 3A4 4 0 0 0 4 3C4 0 2-2 0-5Z';

function ExpenseFace() {
  return <g className="cloud-expense-face" style={{ '--cash-duration':`${CASH_DURATION.expense}ms` }}>
    <g className="cloud-expense-look">
      <path className="cloud-expense-brows" d="M39 55q6 0 11-5m20-1q4 5 10 5"/>
      <path className="face-eyes" d="M45 61v6m29-8v6"/>
      <path className="face-mouth" d="M55 83q8-7 16-2"/>
    </g>
    <g className="cloud-expense-cry">
      <path className="cloud-expense-brows" d="M39 54q6 0 11-5m20-1q4 5 10 5"/>
      <path className="face-eyes" d="M40 61l10 5-10 3m41-10-10 5 10 3"/>
      <path className="face-mouth cloud-expense-open-mouth" d="M53 84q10-11 21-2q-9 8-21 2Z"/>
    </g>
    <g className="cloud-expense-recover">
      <path className="cloud-expense-brows" d="M40 55q5 0 10-3m20-1q4 3 10 3"/>
      <path className="face-eyes" d="M40 63q5 4 11-1m20-1q5 3 10-2"/>
      <path className="face-mouth cloud-expense-lip" d="M56 82q6-4 13-1"/>
    </g>
    <g className="cloud-expense-tears">
      <g transform="translate(40 69)"><path className="cloud-expense-tear tear-left" d={TEAR}/><path className="cloud-expense-tear tear-last" d={TEAR}/></g>
      <g transform="translate(81 67)"><path className="cloud-expense-tear tear-right" d={TEAR}/></g>
    </g>
  </g>;
}

const WEATHER_CROP = {
  rain: { x:-9, y:-27, width:70, height:70, viewBox:'0 0 512 512' },
  sun: { x:22, y:22, width:81, height:81, viewBox:'512 0 512 512' },
  night: { x:22, y:-25, width:84, height:84, viewBox:'1024 0 512 512' },
  snow: { x:17, y:64, width:91, height:54, viewBox:'0 512 512 512' },
  wind: { x:73, y:8, width:58, height:58, viewBox:'512 512 512 512' },
  storm: { x:91, y:12, width:35, height:60, viewBox:'1024 512 512 512' },
};
function WeatherAccessory({ environment }) {
  const crop = WEATHER_CROP[environment];
  if (!crop && environment !== 'fog') return null;
  return <g key={environment} className={`cloud-weather cloud-${environment}`}>
    {crop && <g className="weather-art-shell"><svg {...crop} preserveAspectRatio="xMidYMid meet"><image href={weatherAtlas} width="1536" height="1024"/></svg></g>}
    {environment === 'fog' && <g className="cloud-fog-lines"><path d="M18 38h37"/><path d="M75 47h38"/><path d="M28 57h48"/></g>}
    {environment === 'rain' && <g className="cloud-weather-drops"><path d="M14 80l-2 7m17-6-2 7m80-7-2 7"/></g>}
    {environment === 'snow' && <g className="cloud-snow-dots"><circle cx="18" cy="29" r="2"/><circle cx="104" cy="34" r="2"/><circle cx="96" cy="18" r="1.6"/></g>}
    {environment === 'storm' && <g className="cloud-storm-drops"><path d="M16 78l-2 7m26-7-2 7"/></g>}
    {environment === 'night' && <text className="cloud-sleep-z" x="100" y="24">z</text>}
  </g>;
}

// The generated atlases all use the same transparent 4x2 layout.  Keeping
// each cell in an isolated nested SVG gives the browser a stable clip while
// CSS controls the short frame timing; the vector face remains the visual
// source of truth and the art reads as a soft paper echo beneath it.
const MASCOT_ATLAS = { width:1774, height:887, cellWidth:443.5, cellHeight:443.5 };
// The last two taps share the same gentle annoyed state.  The atlas also has
// a surprised and sleepy frame for future contexts, but those would make the
// current “small red mark” mood feel too intense or change the product state.
const EXPRESSION_FRAME = [0, 1, 2, 3, 4, 5, 5];
function AtlasCell({ asset, frame, className, style }) {
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  return <svg className={className} x="0" y="0" width="130" height="126" viewBox={`${column * MASCOT_ATLAS.cellWidth} ${row * MASCOT_ATLAS.cellHeight} ${MASCOT_ATLAS.cellWidth} ${MASCOT_ATLAS.cellHeight}`} preserveAspectRatio="xMidYMid meet" style={style} aria-hidden="true">
    <image href={asset} width={MASCOT_ATLAS.width} height={MASCOT_ATLAS.height}/>
  </svg>;
}
function AtlasSequence({ asset, frames, keyId, className, frameMs, opacity = 0.1, delay = 0 }) {
  return <g key={keyId} className={`cloud-atlas-sequence ${className}`} aria-hidden="true">
    {frames.map((frame, index) => <AtlasCell key={`${keyId}-${frame}-${index}`} asset={asset} frame={frame} className="cloud-atlas-frame" style={{ '--atlas-delay':`${delay + index * frameMs}ms`, '--atlas-frame-duration':`${frameMs}ms`, '--atlas-opacity':opacity }}/>) }
  </g>;
}

function Cloud({ mood, cashAction, cashId, environment, tapNonce }) {
  // The final two taps are playful annoyance, not a threatening angry face.
  // Keep the familiar soft face and communicate the mood with one small mark.
  const faceMood = cashAction === 'income' ? 1 : mood >= 5 ? 2 : mood;
  const resting = mood === 0 && !cashAction;
  return <svg className="mascot" id="mascot" viewBox="0 0 130 126" data-raster={resting ? 'true' : 'false'} aria-hidden="true">
    <image className="mascot-main-art" href={mainCloudAsset} x="1" y="0" width="128" height="126" preserveAspectRatio="xMidYMid meet"/>
    {!cashAction && tapNonce > 0 && <>
      <AtlasSequence asset={mascotTapAtlas} frames={[0,1,2,3,4,5,6,7]} keyId={`tap-${tapNonce}`} className="cloud-tap-atlas" frameMs={27.5} opacity={0.1}/>
      <AtlasSequence asset={mascotExpressionsAtlas} frames={[EXPRESSION_FRAME[Math.max(0, Math.min(6, mood))]]} keyId={`expression-${tapNonce}-${mood}`} className="cloud-expression-atlas" frameMs={180} opacity={0.07} delay={220}/>
    </>}
    {cashAction && <AtlasSequence asset={mascotCashAtlas} frames={cashAction === 'expense' ? [0,1,2,3] : [4,5,6,7]} keyId={`cash-${cashId}`} className="cloud-cash-atlas" frameMs={CASH_DURATION[cashAction] / 4} opacity={0.08}/>}
    <g className="cloud-vector-art">
      <path className="mascot-body" d={BODY}/>
      <g className="cloud-face-idle">
        <g className="cloud-face">
        {cashAction !== 'expense' && <><g className={resting && environment === 'night' ? 'cloud-sleep-eyes' : 'cloud-eyes'}><MorphFacePath pose={resting && environment === 'night' ? SLEEP_EYES : EYE_POSES[faceMood]} kind="eyes" className="face-eyes"/></g><MorphFacePath pose={MOUTH_POSES[faceMood]} kind="mouth" className={`face-mouth ${faceMood === 6 ? 'cloud-angry-mouth' : ''}`}/></>}
        <ellipse className="cloud-blush" cx="35" cy="74" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
        <ellipse className="cloud-blush" cx="88" cy="72" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
        {mood === 2 && <g className="cloud-blush-lines"><path d="m30 72 2 4m3-5 2 4m45-5 2 4m3-5 2 4"/></g>}
        {cashAction === 'expense' && <ExpenseFace key={cashId}/>}
        </g>
      </g>
    </g>
    {resting && <WeatherAccessory environment={environment}/>}
    {cashAction && <g key={cashId} className={`cloud-cash-hands is-${cashAction}`}><path className="cloud-cash-hand-left" d="M34 91q4 10 17 7"/><path className="cloud-cash-hand-right" d="M93 88q-1 11-14 10"/></g>}
    {mood === 3 && !cashAction && <text className="cloud-question" x="101" y="32">?</text>}
    {mood === 4 && !cashAction && <>
      <g className="cloud-sigh" aria-hidden="true">
        <path d="M78 81q7 5 14 0q5-3 9 0"/>
        <path d="M88 72q6-4 12 0"/>
      </g>
      <path className="cloud-teardrop" d="M92 54q5 7 0 11q-5-4 0-11Z"/>
    </>}
    {mood >= 5 && !cashAction && <g className={`cloud-anger-symbol ${mood === 6 ? 'is-strong' : ''}`} aria-hidden="true">
      <path d="M96 16l4 4 6-2-1 6 5 4-5 4 1 6-6-2-4 5-4-5-6 2 1-6-5-4 5-4-1-6 6 2 4-4Z"/>
      <path d="m96 26 5 5m0-5-5 5"/>
    </g>}
  </svg>;
}

function CashCelebration({ event, cloudVisible }) {
  return <span key={event.id} className={`money-celebration is-${event.type}`} style={{ '--cash-duration':`${CASH_DURATION[event.type]}ms` }} aria-hidden="true">
    <svg className="money-streaks" viewBox="0 0 70 76"><path d="M17 61 39 27"/><path d="m30 66 20-30"/><path d="m12 42 9-14"/></svg>
    <span className="money-bundle-flight"><svg className="money-bundle" viewBox="0 0 56 38">
      <rect className="money-sheet-back" x="4" y="3" width="40" height="24" rx="4" transform="rotate(-13 24 15)"/>
      <rect className="money-sheet-middle" x="8" y="7" width="40" height="24" rx="4" transform="rotate(-5 28 19)"/>
      <rect className="money-sheet-front" x="11" y="10" width="40" height="24" rx="4"/>
      <path className="money-print" d="M20 15h-4v14h4m22-14h4v14h-4m-19-12 7 6 7-6m-7 6v7m-5-5h10m-10 3h10"/>
    </svg></span>
    {event.type === 'income' && cloudVisible && <svg className="money-cotton-tuck" viewBox="0 0 60 28"><path d="M3 22C-2 17 2 7 11 9C13 1 23 1 29 6C35 0 44 4 46 10C56 5 63 15 56 22C51 29 39 27 31 25C22 31 9 29 3 22Z"/></svg>}
  </span>;
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

export default function PocketMascot({ mascotRef, t, onTap, canConfirm = false, busy = false, confirmLabel, onConfirm, celebrate = null, environment = null }) {
  const [step, setStep] = useState(0), [phase, setPhase] = useState('cloud');
  const [signTaps, setSignTaps] = useState(0), [flight, setFlight] = useState(null), [celebration, setCelebration] = useState(null), [confirmFrame, setConfirmFrame] = useState(0), [tapNonce, setTapNonce] = useState(0);
  const stepRef = useRef(0), tapsRef = useRef(0), buttonRef = useRef(null), flightRef = useRef(null);
  const motionRef = useRef(null), cashMotionRef = useRef(null), cashAnimationRef = useRef(null), deadlineRef = useRef(0), lastPhase = useRef('cloud');
  const celebrationRef = useRef(celebrate?.id), celebrationTimer = useRef(null);
  const celebrationId = celebrate?.id, celebrationType = celebrate?.type;
  const reset = useCallback(() => {
    stepRef.current = 0; tapsRef.current = 0;
    setStep(0); setSignTaps(0); setFlight(null); setPhase('cloud'); setTapNonce(0);
  }, []);

  // One deadline from the seventh tap. Rerenders and the landing do not restart it.
  useEffect(() => {
    if (step !== 7) return;
    const landing = setTimeout(() => setPhase('falling'), 280);
    const restore = setTimeout(reset, Math.max(0, deadlineRef.current - Date.now()));
    return () => { clearTimeout(landing); clearTimeout(restore); };
  }, [step, reset]);

  useEffect(() => {
    if (celebrationId == null || celebrationId === celebrationRef.current || !Object.hasOwn(CASH_DURATION, celebrationType)) return;
    celebrationRef.current = celebrationId;
    clearTimeout(celebrationTimer.current);
    setCelebration({ id: celebrationId, type: celebrationType });
    celebrationTimer.current = setTimeout(() => setCelebration(null), CASH_DURATION[celebrationType]);
  }, [celebrationId, celebrationType]);

  useEffect(() => {
    if (busy) setConfirmFrame(3);
    else if (celebrationId != null) {
      setConfirmFrame(2);
      const timer = setTimeout(() => setConfirmFrame(0), 520);
      return () => clearTimeout(timer);
    } else setConfirmFrame(0);
  }, [busy, celebrationId]);

  useEffect(() => () => {
    clearTimeout(celebrationTimer.current);
    cashAnimationRef.current?.cancel();
  }, []);

  // This layer adds a cash gesture without changing the toy's mood or deadline.
  // A new save picks up the current pose; a poke immediately returns to the toy.
  useLayoutEffect(() => {
    const node = cashMotionRef.current;
    if (!node || !celebration || phase !== 'cloud') { cashAnimationRef.current?.cancel(); return; }
    const current = getComputedStyle(node).transform;
    cashAnimationRef.current?.cancel();
    const poses = celebration.type === 'income' ? [
      { transform:current, offset:0 },
      { transform:'translate3d(0,-2%,0) rotate(3deg) scale(.98,1.03)', offset:.2 },
      { transform:'translate3d(0,-1%,0) rotate(2deg)', offset:.43 },
      { transform:'translate3d(0,2%,0) rotate(-2deg) scale(1.055,.945)', offset:.59 },
      { transform:'translate3d(0,0,0) rotate(.5deg) scale(1.02,.99)', offset:.78 },
      { transform:'translate3d(0,0,0) rotate(0) scale(1)', offset:1 },
    ] : [
      { transform:current, offset:0 },
      { transform:'translate3d(0,2%,0) rotate(0) scale(1.055,.94)', offset:.16 },
      { transform:'translate3d(-1%,-1%,0) rotate(-7deg) scale(.99,1.04)', offset:.32 },
      { transform:'translate3d(-3%,1%,0) rotate(4deg) scale(.95,1.035)', offset:.46 },
      { transform:'translate3d(0,.7%,0) rotate(-1deg) scale(1.012,.99)', offset:.7 },
      { transform:'translate3d(0,0,0) rotate(0) scale(1)', offset:1 },
    ];
    const easing = getComputedStyle(node).getPropertyValue('--ease-out').trim();
    cashAnimationRef.current = node.animate(poses.map(pose => ({ ...pose, easing })), { duration:CASH_DURATION[celebration.type], easing:'linear' });
  }, [celebration, phase]);

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
    clearTimeout(celebrationTimer.current);
    setCelebration(null);
    setTapNonce(value => value + 1);
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
    <span className="mascot-stack" data-cash={celebration?.type} data-mood={Math.min(step,6)}>
      <Tappable Component="button" type="button" interactiveAnimation="opacity" ref={buttonRef} className="mascot-toy" data-phase={phase} data-mood={Math.min(step,6)} data-sign-taps={signTaps} aria-label={label} aria-disabled={phase === 'burst' || phase === 'falling'} onClick={tap}>
        {!sign && <span ref={node => { motionRef.current = node; }} className="cloud-motion"><span ref={node => { if (mascotRef) mascotRef.current = node; }} className="cloud-touch"><span ref={cashMotionRef} className="cloud-cash-motion"><span className="cloud-shell"><Cloud mood={Math.min(step,6)} tapNonce={tapNonce} cashAction={phase === 'cloud' ? celebration?.type : null} cashId={celebration?.id} environment={environment}/></span></span></span></span>}
        {phase === 'burst' && <span className="cloud-pop" aria-hidden="true"><span className="cloud-pop-word">{t('cloudPopSound')}</span>{Array.from({length:6},(_,i) => <i key={i} style={{ '--puff-x':`${Math.cos(i * Math.PI / 3) * 32}px`, '--puff-y':`${Math.sin(i * Math.PI / 3) * 27}px` }}/>)}</span>}
        {sign && <span className="stop-sign-rest" data-hidden={phase === 'falling'}><StopSign/></span>}
      </Tappable>
      {canConfirm && <Tappable Component="button" type="button" interactiveAnimation="opacity" className="mascot-confirm" aria-label={confirmLabel || t('save')} title={confirmLabel || t('save')} aria-busy={busy} data-confirm-frame={confirmFrame} disabled={busy} onPointerDown={() => setConfirmFrame(1)} onPointerUp={() => { if (!busy) setConfirmFrame(0); }} onPointerCancel={() => { if (!busy) setConfirmFrame(0); }} onClick={event => { event.stopPropagation(); onConfirm?.(); }}><i className="confirm-art" style={{ backgroundImage:`url(${confirmButtonAtlas})` }} aria-hidden="true"/><span aria-hidden="true"><Icon name="check"/></span></Tappable>}
      {celebration && <CashCelebration event={celebration} cloudVisible={phase === 'cloud'}/>}
    </span>
    <span className="cloud-announcement" role="status" aria-live="polite">{step ? t(moodKey) : ''}</span>
    {flight && phase === 'falling' && createPortal(<span ref={flightRef} className="cloud-sign-flight" style={flight}><StopSign/></span>,document.body)}
  </>;
}
