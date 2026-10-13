import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tappable } from '@telegram-apps/telegram-ui';
import { Avatar, Sheet } from './AccountViews.jsx';
import { REACTION_EMOJIS, normalizeReactionEmoji } from '../public/reactions.mjs';
import { createId } from './id.mjs';
import './circle-reactions.css';

const center = node => {
  const rect = node?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x:innerWidth / 2, y:innerHeight * .7 };
};

function FlyingEmoji({ event, onFinish }) {
  const ref = useRef(null), done = useRef(onFinish);
  done.current = onFinish;
  useLayoutEffect(() => {
    const node = ref.current, { start, end, incoming } = event;
    const pose = (x, y, scale, rotate = 0) => `translate3d(${x - 32}px,${y - 32}px,0) rotate(${rotate}deg) scale(${scale})`;
    const easing = getComputedStyle(node).getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23,1,0.32,1)';
    const frames = incoming ? [
      { transform:pose(start.x,start.y,.48,-12), opacity:0, offset:0 },
      { transform:pose(start.x,start.y,.7,-8), opacity:1, offset:.12 },
      { transform:pose(end.x,end.y,1.8,8), opacity:1, offset:.52 },
      { transform:pose(end.x,end.y,1.58,-4), opacity:1, offset:.7 },
      { transform:pose(end.x,end.y-20,1.68,1), opacity:0, offset:1 },
    ] : [
      { transform:pose(start.x,start.y,.8,-8), opacity:1, offset:0 },
      { transform:pose(start.x,start.y-12,1.1,6), opacity:1, offset:.22 },
      { transform:pose((start.x+end.x)/2,Math.min(start.y,end.y)-30,1.04,-10), opacity:1, offset:.6 },
      { transform:pose(end.x,end.y,.45,12), opacity:0, offset:1 },
    ];
    const animation = node.animate(frames.map(frame => ({ ...frame, easing })), { duration:incoming ? 960 : 620, fill:'both' });
    let cancelled = false;
    animation.finished.then(() => { if (!cancelled) done.current(event); }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [event]);
  return <span ref={ref} className={`flying-emoji ${event.incoming ? 'is-incoming' : ''}`} aria-hidden="true" data-reaction-id={event.id}>{event.emoji}</span>;
}

export default function CircleReactions({ circle, ledgerId, userId, service, t, onSelf, onHaptic, disabled }) {
  const [target, setTarget] = useState(null), [sheetStyle, setSheetStyle] = useState({});
  const [outgoing, setOutgoing] = useState([]), [incoming, setIncoming] = useState([]);
  const [custom, setCustom] = useState(''), [invalid, setInvalid] = useState(false), [failures, setFailures] = useState([]);
  const portraits = useRef(new Map()), targetPortrait = useRef(null), seen = useRef(new Set()), acknowledgements = useRef(new Set());
  const scope = circle.id + ':' + ledgerId + ':' + userId;
  const scopeRef = useRef(scope), mounted = useRef(true), ackTimer = useRef(null), ackFlight = useRef(null);
  scopeRef.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(ackTimer.current); };
  }, []);

  const flushAck = useCallback(async () => {
    if (ackFlight.current || !acknowledgements.current.size) return;
    const ids = [...acknowledgements.current].slice(0,40), requestScope = scope;
    const operation = service.acknowledgeReactions({ circleId:circle.id, ledgerId, ids });
    ackFlight.current = operation;
    try {
      await operation;
      if (scopeRef.current === requestScope) for (const id of ids) acknowledgements.current.delete(id);
    } catch {} finally { if (ackFlight.current === operation) ackFlight.current = null; }
  }, [service, circle.id, ledgerId, scope]);

  useEffect(() => {
    let cancelled = false, running = false;
    const poll = async () => {
      if (cancelled || running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        await flushAck();
        const response = await service.getReactions(ledgerId);
        if (cancelled || response.circleId !== circle.id) return;
        const fresh = (response.items || []).filter(item => !seen.current.has(item.id));
        if (fresh.length) {
          fresh.forEach(item => seen.current.add(item.id));
          if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
          setIncoming(queue => [...queue, ...fresh.map((item,index) => ({ ...item, incoming:true,
            start:center(portraits.current.get(item.sender.id)),
            end:{ x:innerWidth * (.38 + index % 3 * .12), y:innerHeight * (.35 + index % 2 * .13) },
          }))]);
          onHaptic?.();
        }
      } catch {} finally { running = false; }
    };
    void poll();
    const timer = setInterval(poll, 8000);
    window.addEventListener('focus',poll); document.addEventListener('visibilitychange',poll);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus',poll); document.removeEventListener('visibilitychange',poll); };
  }, [service, ledgerId, circle.id, flushAck, onHaptic]);

  const finishIncoming = useCallback(event => {
    setIncoming(queue => queue.filter(item => item.id !== event.id));
    acknowledgements.current.add(event.id);
    clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(flushAck, 300);
  }, [flushAck]);
  const transmit = async payload => {
    const requestScope = scope;
    try {
      await service.sendReaction(payload);
      if (mounted.current && scopeRef.current === requestScope) setFailures(items => items.filter(item => item.id !== payload.id));
    } catch {
      if (mounted.current && scopeRef.current === requestScope) setFailures(items => items.some(item => item.id === payload.id) ? items : [...items,payload]);
    }
  };
  const send = (value,node) => {
    const emoji = normalizeReactionEmoji(value);
    if (!emoji || !target || disabled) { setInvalid(true); return; }
    setInvalid(false);
    const id = createId(), payload = { id, circleId:circle.id, ledgerId, recipientId:target.id, emoji };
    setOutgoing(items => [...items,{ id, emoji, start:center(node), end:center(targetPortrait.current) }]);
    onHaptic?.();
    void transmit(payload);
  };
  const open = (person,event) => {
    onHaptic?.();
    if (person.id === userId) { onSelf?.(); return; }
    const rect = event.currentTarget.getBoundingClientRect(), width = Math.min(340,innerWidth-28);
    const left = Math.max(14,Math.min(innerWidth-width-14,rect.left+rect.width/2-width/2));
    setSheetStyle({ left, bottom:Math.max(12,Math.min(innerHeight-rect.top+8,innerHeight-400)), '--emoji-origin':`${rect.left+rect.width/2-left}px 100%` });
    setTarget(person); setCustom(''); setInvalid(false);
  };
  const finishOutgoing = useCallback(event => setOutgoing(items => items.filter(item => item.id !== event.id)), []);
  const effects = <div className="emoji-flight-layer">{incoming.slice(0,3).map(event => <FlyingEmoji key={event.id} event={event} onFinish={finishIncoming}/>)}</div>;
  return <>
    <div className="consumer-buttons circle-presence" role="group" aria-label={t('circlePeople')}>
      {circle.members.map(person => <Tappable Component="button" type="button" key={person.id} ref={node => { if (node) portraits.current.set(person.id,node); else portraits.current.delete(person.id); }}
        className={`consumer-chip presence-chip consumer-color-${person.color}`} data-member-id={person.id} data-self={person.id === userId}
        aria-label={person.id === userId ? t('myProfile') : t('sendEmojiTo',{ name:person.name })} aria-haspopup={person.id === userId ? undefined : 'dialog'} aria-expanded={person.id === userId ? undefined : target?.id === person.id}
        disabled={disabled} onClick={event => open(person,event)}><Avatar person={person}/><span>{person.name}</span></Tappable>)}
    </div>
    {!target && createPortal(effects,document.body)}
    {target && <Sheet title={t('sendEmojiTo',{name:target.name})} className="emoji-sheet" style={sheetStyle} onClose={() => { setTarget(null); setOutgoing([]); }}>
      <span className="emoji-recipient" ref={targetPortrait}><Avatar person={target}/></span>
      <div className="emoji-grid" role="group" aria-label={t('emojiChoices')}>{REACTION_EMOJIS.map(emoji => <Tappable Component="button" type="button" key={emoji} aria-label={t('sendEmoji',{emoji})} data-emoji={emoji} disabled={disabled} onClick={event => send(emoji,event.currentTarget)}>{emoji}</Tappable>)}</div>
      <form className="emoji-custom" onSubmit={event => { event.preventDefault(); send(custom,event.currentTarget); }}>
        <input aria-label={t('customEmoji')} placeholder={t('customEmoji')} value={custom} maxLength={64} onChange={event => { setCustom(event.target.value); setInvalid(false); }}/>
        <Tappable Component="button" type="submit" disabled={!custom.trim() || disabled} aria-label={t('sendEmoji',{emoji:custom})}>↑</Tappable>
      </form>
      {invalid && <span className="emoji-error" role="status">{t('errorReaction')}</span>}
      {failures.length > 0 && <button type="button" className="emoji-retry" onClick={() => failures.forEach(payload => void transmit(payload))}>{t('reactionRetry',{n:failures.length})}</button>}
      <div className="emoji-flight-layer">{outgoing.map(event => <FlyingEmoji key={event.id} event={event} onFinish={finishOutgoing}/>)}{incoming.slice(0,3).map(event => <FlyingEmoji key={event.id} event={event} onFinish={finishIncoming}/>)}</div>
    </Sheet>}
    {!target && failures.length > 0 && <button type="button" className="emoji-retry emoji-retry-capsule" onClick={() => failures.forEach(payload => void transmit(payload))}>{t('reactionRetry',{n:failures.length})}</button>}
  </>;
}
