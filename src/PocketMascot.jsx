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
import mascotPopAtlas from '../public/assets/mascot/mascot-pop-frames-v1.png';
// The 256px raster is bundled inline: a cold cache or late network response
// cannot consume the short falling animation before the sign becomes visible.
import stopSignAsset from './stop-sign-compact.png?inline';
import noteCashBundle from '../public/assets/note-cash-bundle-v1.webp';
import MorphFacePath from './MorphFacePath.jsx';
import { EYE_POSES, MOUTH_POSES, SLEEP_EYES } from './mascot-face.mjs';

const BODY = 'M24 53C16 18 48 7 68 18C86-1 121 23 107 52C130 74 113 107 87 101C70 128 38 116 35 98C4 105-5 68 24 53Z';
// Six taps are enough to tell the whole story. The sixth tap is the soft
// little pop; there is no duplicate "furious" pose between taps six and seven.
const MOODS = ['cloudHappy', 'cloudSmile', 'cloudShy', 'cloudQuestion', 'cloudSigh', 'cloudGrumpy'];
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

// Each sheet is decoded once, then clipped into registered cells. A pose is
// the visible artwork, never a translucent duplicate beneath another body.
const MASCOT_ATLAS = { width:1774, height:887, cellWidth:443.5, cellHeight:443.5 };
const POP_DURATION = 280;
const RETURN_DURATION = 220;
let stopSignDecoded;
function prepareStopSign() {
  return stopSignDecoded ||= new Promise(resolve => {
    const image = new Image();
    image.onload = () => image.decode?.().then(resolve, resolve) || resolve();
    image.onerror = resolve;
    image.src = stopSignAsset;
  });
}
// Keep the last resting pose as a small pout with one tiny anger mark.
const EXPRESSION_FRAME = [0, 1, 2, 3, 4, 5];
function AtlasCell({ asset, frame, className, style }) {
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  return <svg className={className} x="0" y="0" width="130" height="126" viewBox={`${column * MASCOT_ATLAS.cellWidth} ${row * MASCOT_ATLAS.cellHeight} ${MASCOT_ATLAS.cellWidth} ${MASCOT_ATLAS.cellHeight}`} preserveAspectRatio="xMidYMid meet" style={style} aria-hidden="true">
    <image href={asset} width={MASCOT_ATLAS.width} height={MASCOT_ATLAS.height}/>
  </svg>;
}
function AtlasSequence({ asset, frames, keyId, className, frameMs }) {
  return <g key={keyId} className={`cloud-atlas-sequence ${className}`} aria-hidden="true">
    {frames.map((frame, index) => <AtlasCell key={`${keyId}-${frame}-${index}`} asset={asset} frame={frame} className="cloud-atlas-frame" style={{ '--atlas-delay':`${index * frameMs}ms`, '--atlas-frame-duration':`${frameMs}ms` }}/>) }
  </g>;
}

function CloudPop() {
  // Keep the last grumpy face visible through the anticipation. The old pop
  // sheet began with a smile, which made the cloud look happy while exploding.
  return <g className="cloud-pop-sequence cloud-pop-atlas" aria-hidden="true">
    <g className="cloud-pop-anger"><AtlasCell asset={mascotExpressionsAtlas} frame={5} className="cloud-pop-anger-frame"/></g>
    <g className="cloud-pop-puffs">
      <path className="cloud-pop-puff puff-one" d="M59 83c-4-3-7-1-7 3s4 6 8 4c3-2 3-5-1-7Z"/>
      <path className="cloud-pop-puff puff-two" d="M66 82c-4-2-7 1-6 5s5 5 8 2c2-3 1-5-2-7Z"/>
      <path className="cloud-pop-puff puff-three" d="M72 84c-3-1-6 2-5 5s5 4 7 1c2-2 1-5-2-6Z"/>
    </g>
  </g>;
}

function SighFume() {
  return <g className="cloud-sigh-fume" aria-hidden="true">
    <path className="cloud-sigh-fume-line fume-one" d="M60 80c-3-5-2-9 2-12s5-6 3-11"/>
    <path className="cloud-sigh-fume-line fume-two" d="M66 81c1-5 5-7 5-12s-1-7 2-10"/>
    <path className="cloud-sigh-fume-line fume-three" d="M72 82c4-3 7-5 7-9s-2-5 1-8"/>
  </g>;
}

function Cloud({ mood, cashAction, cashId, environment, tapNonce, bursting = false, returning = false }) {
  // The final resting pose is playful annoyance, not a threatening angry face.
  // Keep the familiar soft face and communicate the mood with one small mark.
  const faceMood = cashAction === 'income' ? 1 : mood >= 5 ? 2 : mood;
  const resting = mood === 0 && !cashAction && !bursting;
  const expressionFrame = resting && environment === 'night'
    ? 7 // sleepy
    : resting && environment === 'storm'
      ? 6 // a tiny surprised look at the thunder
    : EXPRESSION_FRAME[Math.max(0, Math.min(5, mood))];
  const sighing = mood === 4 && !cashAction && !bursting && !returning;
  const showPose = !cashAction && !sighing && !bursting && !returning;
  const showOriginal = showPose && expressionFrame === 0;
  return <svg className="mascot" id="mascot" viewBox="0 0 130 126" data-raster={!cashAction ? 'true' : 'false'} data-bursting={bursting} data-returning={returning} data-pose-switch={tapNonce > 0 && showPose} aria-hidden="true">
    <defs>
      <path id="cloud-annoyed-mark-area" d="M103.4 6h9.4v10.2h-9.4Z M114.7 6.5h7.1v11.4h-7.1Z M106.5 17.3h10.6v6.6h-10.6Z"/>
      <mask id="cloud-annoyed-body-mask" style={{stroke:'none'}}><rect width="130" height="126" fill="white"/><use href="#cloud-annoyed-mark-area" fill="black"/></mask>
      <clipPath id="cloud-annoyed-mark-clip"><use href="#cloud-annoyed-mark-area"/></clipPath>
    </defs>
    <g className="cloud-pose-art">
      <image className="cloud-pose" data-active={showOriginal} href={mainCloudAsset} x="1" y="0" width="128" height="126" preserveAspectRatio="xMidYMid meet"/>
      {[1,2,3,4,5,6,7].map(frame => <g key={frame} className="cloud-pose" data-active={showPose && expressionFrame === frame} data-expression={frame}>
        <g mask={frame === 5 ? 'url(#cloud-annoyed-body-mask)' : undefined}>
          <AtlasCell asset={mascotExpressionsAtlas} frame={frame} className="cloud-expression-art"/>
        </g>
        {frame === 5 && <g className="cloud-annoyed-mark"><g clipPath="url(#cloud-annoyed-mark-clip)"><AtlasCell asset={mascotExpressionsAtlas} frame={frame}/></g></g>}
      </g>)}
    </g>
    {bursting && <CloudPop/>}
    {returning && !cashAction && !bursting && <g className="cloud-return-art"><image href={mainCloudAsset} x="1" y="0" width="128" height="126" preserveAspectRatio="xMidYMid meet"/></g>}
    {(cashAction || sighing) && !bursting && <g className="cloud-vector-art">
      <path className="mascot-body" d={BODY}/>
      <g className="cloud-face-idle">
        <g className="cloud-face">
        {cashAction !== 'expense' && <><g className={resting && environment === 'night' ? 'cloud-sleep-eyes' : 'cloud-eyes'}><MorphFacePath pose={resting && environment === 'night' ? SLEEP_EYES : EYE_POSES[faceMood]} kind="eyes" className="face-eyes"/></g><MorphFacePath pose={MOUTH_POSES[faceMood]} kind="mouth" className={`face-mouth ${faceMood === 6 ? 'cloud-angry-mouth' : ''}`}/></>}
        <ellipse className="cloud-blush" cx="35" cy="74" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
        <ellipse className="cloud-blush" cx="88" cy="72" rx={mood === 2 ? 11 : 7} ry={mood === 2 ? 6 : 4}/>
        {mood === 2 && <g className="cloud-blush-lines"><path d="m30 72 2 4m3-5 2 4m45-5 2 4m3-5 2 4"/></g>}
        {cashAction === 'expense' && <ExpenseFace key={cashId}/>}
        {sighing && <SighFume/>}
        </g>
      </g>
    </g>}
    {resting && !returning && (environment === 'night' ? <g className="cloud-night"><text className="cloud-sleep-z" x="100" y="24">z</text></g> : <WeatherAccessory environment={environment}/>)}
    {cashAction && <g key={cashId} className={`cloud-cash-hands is-${cashAction}`}><path className="cloud-cash-hand-left" d="M34 91q4 10 17 7"/><path className="cloud-cash-hand-right" d="M93 88q-1 11-14 10"/></g>}
  </svg>;
}

function CashCelebration({ event, cloudVisible }) {
  return <span key={event.id} className={`money-celebration is-${event.type}`} data-received={event.received || undefined} style={{ '--cash-duration':`${CASH_DURATION[event.type]}ms` }} aria-hidden="true">
    <svg className="money-streaks" viewBox="0 0 70 76"><path d="M17 61 39 27"/><path d="m30 66 20-30"/><path d="m12 42 9-14"/></svg>
    <span className="money-bundle-flight">{event.received ? <img className="money-bundle" src={noteCashBundle} alt=""/> : <svg className="money-bundle money-bundle-art" viewBox="1635 50 115 105">
      <image href={mascotCashAtlas} width={MASCOT_ATLAS.width} height={MASCOT_ATLAS.height}/>
    </svg>}</span>
    {event.type === 'income' && cloudVisible && <svg className="money-cotton-tuck" viewBox="0 0 60 28"><path d="M3 22C-2 17 2 7 11 9C13 1 23 1 29 6C35 0 44 4 46 10C56 5 63 15 56 22C51 29 39 27 31 25C22 31 9 29 3 22Z"/></svg>}
  </span>;
}

function StopSign() {
  const [ready, setReady] = useState(false);
  return <span className="cloud-stop-sign-wrap" data-ready={ready} aria-hidden="true"><span className="cloud-stop-sign-fallback"><i>止まれ</i></span><img className="cloud-stop-sign" src={stopSignAsset} alt="" onLoad={() => setReady(true)} onError={() => setReady(false)}/></span>;
}

export default function PocketMascot({ mascotRef, t, onTap, canConfirm = false, busy = false, confirmLabel, onConfirm, celebrate = null, environment = null, receiving = false }) {
  const [step, setStep] = useState(0), [phase, setPhase] = useState('cloud');
  const [returning, setReturning] = useState(false);
  const [signTaps, setSignTaps] = useState(0), [flight, setFlight] = useState(null), [celebration, setCelebration] = useState(null), [confirmFrame, setConfirmFrame] = useState(0), [tapNonce, setTapNonce] = useState(0);
  const stepRef = useRef(0), tapsRef = useRef(0), buttonRef = useRef(null), flightRef = useRef(null), signRef = useRef(null);
  const motionRef = useRef(null), cashMotionRef = useRef(null), cashAnimationRef = useRef(null), signAnimationRef = useRef(null), deadlineRef = useRef(0), lastPhase = useRef('cloud'), phaseRef = useRef('cloud'), signExitRef = useRef(false);
  const celebrationRef = useRef(celebrate?.id), celebrationTimer = useRef(null), returnTimer = useRef(null);
  const celebrationId = celebrate?.id, celebrationType = celebrate?.type;
  useEffect(() => {
    // Decode before an interaction, so the first short sequence cannot finish
    // while its image is still downloading on a mobile connection.
    void prepareStopSign();
    for (const src of [mascotTapAtlas, mascotCashAtlas, mascotPopAtlas, noteCashBundle]) {
      const image = new Image();
      image.src = src;
      image.decode?.().catch(() => {});
    }
  }, []);
  const finishReset = useCallback(() => {
    stepRef.current = 0; tapsRef.current = 0;
    setStep(0); setSignTaps(0); setFlight(null); setPhase('cloud'); setTapNonce(0);
    clearTimeout(returnTimer.current);
    setReturning(true);
    returnTimer.current = setTimeout(() => setReturning(false), RETURN_DURATION);
  }, []);

  const reset = useCallback((animateSign = false) => {
    clearTimeout(returnTimer.current);
    const signNode = signRef.current;
    if (animateSign && phaseRef.current === 'sign' && signNode && !signExitRef.current) {
      signExitRef.current = true;
      signAnimationRef.current?.cancel();
      const current = getComputedStyle(signNode).transform;
      const animation = signNode.animate([
        { opacity:1, transform:current },
        { opacity:.86, transform:'translate3d(3px,-5px,0) rotate(-4deg) scale(.92)', offset:.42 },
        { opacity:0, transform:'translate3d(0,-12px,0) rotate(2deg) scale(.8)' },
      ], { duration:240, easing:'cubic-bezier(.22,.85,.32,1)', fill:'both' });
      signAnimationRef.current = animation;
      animation.finished.then(() => { signExitRef.current = false; finishReset(); }).catch(() => { signExitRef.current = false; });
      return;
    }
    finishReset();
  }, [finishReset]);

  useEffect(() => { if (receiving && phaseRef.current !== 'cloud') reset(true); }, [receiving, reset]);

  // One deadline from the sixth tap. Rerenders and the landing do not restart it.
  useEffect(() => {
    if (step !== 6) return;
    // Decode and pop run together, but this cycle owns exactly one hand-off.
    // Image readiness must not rerun the effect after the sign has landed.
    // The inline asset is predecoded, but decoding must never own the clock:
    // even a broken decoder gets a visible fallback for the entire flight.
    const landing = setTimeout(() => setPhase('falling'), POP_DURATION);
    const restore = setTimeout(() => reset(true), Math.max(0, deadlineRef.current - Date.now()));
    return () => { clearTimeout(landing); clearTimeout(restore); };
  }, [step, reset]);

  useEffect(() => {
    if (celebrationId == null || celebrationId === celebrationRef.current || !Object.hasOwn(CASH_DURATION, celebrationType)) return;
    celebrationRef.current = celebrationId;
    clearTimeout(celebrationTimer.current);
    clearTimeout(returnTimer.current);
    setReturning(false);
    if (celebrate?.received) {
      signAnimationRef.current?.cancel(); signExitRef.current = false;
      stepRef.current = 0; tapsRef.current = 0;
      setStep(0); setSignTaps(0); setFlight(null); setPhase('cloud'); setTapNonce(0);
    }
    setCelebration({ id: celebrationId, type: celebrationType, received:celebrate?.received });
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
    clearTimeout(returnTimer.current);
    cashAnimationRef.current?.cancel();
    signAnimationRef.current?.cancel();
  }, []);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useLayoutEffect(() => {
    if (phase !== 'sign' || !signTaps || signExitRef.current || !signRef.current) return;
    signAnimationRef.current?.cancel();
    const amount = signTaps === 1 ? 3 : 6;
    const angle = signTaps === 1 ? 3 : 6;
    const current = getComputedStyle(signRef.current).transform;
    const animation = signRef.current.animate([
      { transform:current },
      { transform:`translate3d(${-amount}px,0,0) rotate(${-angle}deg)`, offset:.18 },
      { transform:`translate3d(${amount * .72}px,0,0) rotate(${angle * .72}deg)`, offset:.42 },
      { transform:`translate3d(${-amount * .32}px,0,0) rotate(${-angle * .32}deg)`, offset:.7 },
      { transform:'translate3d(0,0,0) rotate(0deg)' },
    ], { duration:signTaps === 1 ? 360 : 480, easing:'cubic-bezier(.22,.75,.28,1)', fill:'both' });
    signAnimationRef.current = animation;
    return () => animation.cancel();
  }, [phase, signTaps]);

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

  useLayoutEffect(() => {
    if (!flight || phase !== 'falling') return;
    const animation = flightRef.current.animate([
      { transform:`translateY(${-flight.top - flight.height - 24}px) rotate(-5deg)`, easing:'cubic-bezier(.42,0,.8,.6)' },
      { transform:'translateY(2px) rotate(2deg)', offset:.72, easing:'cubic-bezier(.2,.75,.3,1)' },
      { transform:'translateY(-1px) rotate(-1deg)', offset:.88, easing:'ease-out' },
      { transform:'translateY(0) rotate(0)' },
    ], { duration:540, fill:'both' });
    let cancelled = false;
    animation.finished.then(() => { if (!cancelled) { setPhase('sign'); setFlight(null); } }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [flight, phase]);

  useLayoutEffect(() => {
    const returning = phase === 'cloud' && lastPhase.current !== 'cloud';
    lastPhase.current = phase;
    if (!returning) return;
    // The tap atlas already carries the physical return. Fade the wrapper
    // only; a second scale/rotation here made the cloud shiver on landing.
    const animation = motionRef.current?.animate([{ opacity:0 }, { opacity:1 }], { duration:RETURN_DURATION, easing:getComputedStyle(buttonRef.current).getPropertyValue('--ease-out').trim() });
    return () => animation?.cancel();
  }, [phase]);

  const tap = () => {
    if (phase === 'burst' || phase === 'falling' || (stepRef.current === 6 && phase !== 'sign')) return;
    clearTimeout(celebrationTimer.current);
    clearTimeout(returnTimer.current);
    setReturning(false);
    setCelebration(null);
    setTapNonce(value => value + 1);
    onTap?.();
    if (phase === 'sign') {
      const next = ++tapsRef.current;
      if (next === 3) reset(true); else setSignTaps(next);
      return;
    }
    const next = Math.min(6, ++stepRef.current);
    setStep(next);
    if (next === 6) { deadlineRef.current = Date.now() + 7000; setPhase('burst'); }
  };
  const sign = phase === 'sign' || phase === 'falling';
  const moodKey = step === 6 ? 'cloudPopped' : MOODS[step];
  const label = sign ? t(signTaps ? 'cloudRestoreAgain' : 'cloudRestore') : t('cloudTap', { mood:t(moodKey) });
  return <>
    <span className="mascot-stack" data-cash={celebration?.type} data-mood={Math.min(step,6)}>
      <Tappable Component="button" type="button" interactiveAnimation="opacity" ref={buttonRef} className="mascot-toy" data-phase={phase} data-mood={Math.min(step,6)} data-sign-taps={signTaps} data-returning={returning} aria-label={label} aria-disabled={phase === 'burst' || phase === 'falling'} onClick={tap}>
        {!sign && <span ref={node => { motionRef.current = node; }} className="cloud-motion"><span ref={node => { if (mascotRef) mascotRef.current = node; }} className="cloud-touch"><span ref={cashMotionRef} className="cloud-cash-motion"><span className="cloud-shell"><Cloud mood={Math.min(step,6)} tapNonce={tapNonce} cashAction={phase === 'cloud' ? celebration?.type : null} cashId={celebration?.id} environment={environment} bursting={phase === 'burst'} returning={returning}/></span></span></span></span>}
        {sign && <span ref={signRef} className="stop-sign-rest" data-hidden={phase === 'falling'}><StopSign/></span>}
      </Tappable>
      {canConfirm && <Tappable Component="button" type="button" interactiveAnimation="opacity" className="mascot-confirm" aria-label={confirmLabel || t('save')} title={confirmLabel || t('save')} aria-busy={busy} data-confirm-frame={confirmFrame} disabled={busy} onPointerDown={() => setConfirmFrame(1)} onPointerUp={() => { if (!busy) setConfirmFrame(0); }} onPointerCancel={() => { if (!busy) setConfirmFrame(0); }} onClick={event => { event.stopPropagation(); onConfirm?.(); }}><i className="confirm-art" style={{ backgroundImage:`url(${confirmButtonAtlas})` }} aria-hidden="true"/><span aria-hidden="true"><Icon name="check"/></span></Tappable>}
      {celebration && <CashCelebration event={celebration} cloudVisible={phase === 'cloud'}/>}
    </span>
    <span className="cloud-announcement" role="status" aria-live="polite">{step ? t(moodKey) : ''}</span>
    {flight && phase === 'falling' && createPortal(<span ref={flightRef} className="cloud-sign-flight" style={flight}><StopSign/></span>,document.body)}
  </>;
}
