import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tappable } from '@telegram-apps/telegram-ui';
import { Avatar, Sheet } from './AccountViews.jsx';
import { REACTION_EMOJIS, normalizeReactionEmoji } from '../public/reactions.mjs';
import { createId } from './id.mjs';
import { createReactionSendQueue } from './reaction-send.mjs';
import ReactionReception from './ReactionReception.jsx';
import './circle-reactions.css';

const center = node => {
  const rect = node?.getBoundingClientRect();
  return rect?.width && rect?.height ? { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 } : { x:innerWidth / 2, y:innerHeight * .76 };
};
const easeOut = node => getComputedStyle(node).getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23,1,0.32,1)';

function FlyingEmoji({ event, onFinish, visible }) {
  const ref = useRef(null), done = useRef(onFinish), animation = useRef(null);
  done.current = onFinish;
  useLayoutEffect(() => {
    const node = ref.current, { start, end } = event;
    const pose = (x,y,scale,rotate = 0) => `translate3d(${x-28}px,${y-28}px,0) rotate(${rotate}deg) scale(${scale})`;
    animation.current = node.animate([
      { transform:pose(start.x,start.y,.94,-6), opacity:1, offset:0 },
      { transform:pose(start.x,start.y-10,1.12,5), opacity:1, offset:.18 },
      { transform:pose((start.x+end.x)/2,Math.min(start.y,end.y)-28,1.04,-8), opacity:1, offset:.56 },
      { transform:pose(end.x,end.y,.72,10), opacity:0, offset:1 },
    ].map(frame => ({ ...frame, easing:easeOut(node) })), { duration:480, fill:'both' });
    let cancelled = false;
    animation.current.finished.then(() => { if (!cancelled) done.current(event); }).catch(() => {});
    return () => { cancelled = true; animation.current?.cancel(); };
  }, [event]);
  useEffect(() => {
    const current = animation.current;
    if (!current || current.playState === 'finished' || current.playState === 'idle') return;
    if (visible) {
      const end = current.effect?.getComputedTiming?.().endTime;
      if (end == null || Number(current.currentTime) < Number(end)) current.play();
    } else current.pause();
  }, [visible]);
  return <span ref={ref} className="flying-emoji" aria-hidden="true" data-reaction-id={event.id}>{event.emoji}</span>;
}

// Keep this receiver mounted at App level. Only the avatar strip is portalled
// into the record page, so navigation never drops a receipt or acknowledgement.
export default function CircleReactions({ circle, ledgerId, userId, service, t, onSelf, onHaptic, disabled, entryTarget }) {
  const [target,setTarget] = useState(null), [sheetStyle,setSheetStyle] = useState({});
  const [outgoing,setOutgoing] = useState([]), [incoming,setIncoming] = useState([]);
  const [custom,setCustom] = useState(''), [customOpen,setCustomOpen] = useState(false), [invalid,setInvalid] = useState(false), [failures,setFailures] = useState([]);
  const [visible,setVisible] = useState(document.visibilityState !== 'hidden');
  const [effectHost] = useState(() => document.createElement('div'));
  const portraits = useRef(new Map()), targetPortrait = useRef(null), seen = useRef(new Set()), acknowledgements = useRef(new Set()), receivedCounts = useRef(new Map());
  const payloadScopes = useRef(new Map()), failureById = useRef(new Map());
  const scope = circle.id + ':' + ledgerId + ':' + userId;
  const scopeRef = useRef(scope), mounted = useRef(true), ackTimer = useRef(null), ackFlight = useRef(null), haptic = useRef(onHaptic);
  scopeRef.current = scope; haptic.current = onHaptic;
  const reactionSender = useMemo(() => createReactionSendQueue({
    send: payload => service.sendReaction(payload),
    onSuccess: payload => {
      const requestScope = payloadScopes.current.get(payload.id);
      payloadScopes.current.delete(payload.id);
      failureById.current.delete(payload.id);
      if (mounted.current && requestScope === scopeRef.current) setFailures([...failureById.current.values()]);
    },
    onFailure: payload => {
      const requestScope = payloadScopes.current.get(payload.id);
      payloadScopes.current.delete(payload.id);
      if (mounted.current && requestScope === scopeRef.current) {
        failureById.current.set(payload.id, payload);
        setFailures([...failureById.current.values()]);
      }
    },
  }), [service, scope]);
  useEffect(() => () => reactionSender.close(), [reactionSender]);
  useEffect(() => {
    // A switched circle/ledger must never inherit a retry badge belonging to
    // the previous scope. The queue itself is recreated by the scope key.
    payloadScopes.current.clear();
    failureById.current.clear();
    setFailures([]);
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange',visibility);
    return () => { mounted.current = false; clearTimeout(ackTimer.current); document.removeEventListener('visibilitychange',visibility); };
  }, []);
  useEffect(() => {
    const updateHost = () => {
      const dialogs = [...document.querySelectorAll('dialog[open]')];
      const host = dialogs.at(-1) || document.body;
      if (effectHost.parentElement !== host) host.appendChild(effectHost);
    };
    const observer = new MutationObserver(changes => {
      if (changes.some(change => change.type === 'attributes' || [...change.addedNodes,...change.removedNodes].some(node => node.nodeType === 1 && (node.matches?.('dialog') || node.querySelector?.('dialog'))))) updateHost();
    });
    observer.observe(document.body,{ childList:true, subtree:true, attributes:true, attributeFilter:['open'] });
    updateHost();
    return () => { observer.disconnect(); effectHost.remove(); };
  }, [effectHost]);
  useEffect(() => { if (entryTarget === null) { setTarget(null); setOutgoing([]); } }, [entryTarget]);

  const flushAck = useCallback(async () => {
    if (ackFlight.current || !acknowledgements.current.size) return;
    const ids = [...acknowledgements.current].slice(0,40), requestScope = scope;
    const operation = service.acknowledgeReactions({ circleId:circle.id, ledgerId, ids });
    ackFlight.current = operation;
    try {
      await operation;
      if (scopeRef.current === requestScope) for (const id of ids) acknowledgements.current.delete(id);
    } catch {} finally { if (ackFlight.current === operation) ackFlight.current = null; }
  }, [service,circle.id,ledgerId,scope]);

  useEffect(() => {
    let cancelled = false, running = false, timer;
    const schedule = delay => { clearTimeout(timer); if (!cancelled) timer = setTimeout(poll,delay); };
    const poll = async () => {
      if (cancelled || running || document.visibilityState === 'hidden') return;
      running = true;
      let delay = 1500;
      try {
        await flushAck();
        const response = await service.getReactions(ledgerId);
        if (cancelled || response.circleId !== circle.id) return;
        const fresh = (response.items || []).filter(item => {
          const key = item.burstId || item.id, count = Math.max(item.burstCount || 0,item.burstIndex || 1);
          const changed = count > (receivedCounts.current.get(key) || 0);
          if (changed) { receivedCounts.current.delete(key); receivedCounts.current.set(key,count); }
          return !seen.current.has(item.id) || changed;
        });
        if (fresh.length) {
          fresh.forEach(item => seen.current.add(item.id));
          if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
          if (receivedCounts.current.size > 64) receivedCounts.current = new Map([...receivedCounts.current].slice(-32));
          setIncoming(queue => [...new Map([...queue,...fresh].map(item => [item.id,item])).values()]);
          if (document.visibilityState !== 'hidden') haptic.current?.();
        }
        if (response.hasMore) delay = 500;
      } catch {} finally { running = false; schedule(delay); }
    };
    void poll();
    const foreground = () => { if (document.visibilityState !== 'hidden') void poll(); else clearTimeout(timer); };
    window.addEventListener('focus',foreground); document.addEventListener('visibilitychange',foreground);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('focus',foreground); document.removeEventListener('visibilitychange',foreground); };
  }, [service,ledgerId,circle.id,flushAck]);

  const markSeen = useCallback(event => {
    acknowledgements.current.add(event.id);
    if (!ackTimer.current) ackTimer.current = setTimeout(() => { ackTimer.current = null; void flushAck(); },180);
  }, [flushAck]);
  const finishIncoming = useCallback(ids => {
    const finished = new Set(ids);
    setIncoming(queue => queue.filter(item => !finished.has(item.id)));
    void flushAck();
  }, [flushAck]);
  const transmit = (payload, retry = false) => {
    if (!payload?.id || !scopeRef.current) return;
    payloadScopes.current.set(payload.id, scopeRef.current);
    failureById.current.delete(payload.id);
    setFailures([...failureById.current.values()]);
    if (!retry || !reactionSender.retry(payload.id)) void reactionSender.enqueue(payload);
  };
  const retryFailures = payloads => payloads.forEach(payload => transmit(payload, true));
  const send = (value,node) => {
    const emoji = normalizeReactionEmoji(value);
    if (!emoji || !target || disabled) { setInvalid(true); return; }
    setInvalid(false);
    const id = createId(), payload = { id,circleId:circle.id,ledgerId,recipientId:target.id,emoji };
    setOutgoing(items => [...items,{ id,emoji,start:center(node),end:center(targetPortrait.current) }]);
    onHaptic?.(); transmit(payload);
  };
  const open = (person,event) => {
    onHaptic?.();
    if (person.id === userId) { onSelf?.(); return; }
    const rect = event.currentTarget.getBoundingClientRect(), width = Math.min(380,innerWidth-24);
    const left = Math.max(12,Math.min(innerWidth-width-12,rect.left+rect.width/2-width/2));
    setSheetStyle({ left,bottom:Math.max(12,Math.min(innerHeight-rect.top+10,innerHeight-230)),'--emoji-origin':`${rect.left+rect.width/2-left}px 100%` });
    setTarget(person); setCustom(''); setCustomOpen(false); setInvalid(false);
  };
  const finishOutgoing = useCallback(event => setOutgoing(items => items.filter(item => item.id !== event.id)),[]);
  // The receiver stays alive during navigation; the member controls have
  // exactly one allowed home. Never fall back to rendering beside AppRoot
  // while its portal target is unmounted or still being attached.
  const railTarget = entryTarget?.isConnected && entryTarget.matches('#record-view .finish .circle-presence-host') ? entryTarget : null;
  const people = <div className="consumer-buttons circle-presence" role="group" aria-label={t('circlePeople')}>
    {circle.members.map(person => <Tappable Component="button" type="button" key={person.id} ref={node => { if (node) portraits.current.set(person.id,node); else portraits.current.delete(person.id); }}
      className={`consumer-chip presence-chip consumer-color-${person.color}`} data-member-id={person.id} data-self={person.id === userId}
      aria-label={person.id === userId ? t('myProfile') : t('sendEmojiTo',{ name:person.name })} aria-haspopup={person.id === userId ? undefined : 'dialog'} aria-expanded={person.id === userId ? undefined : target?.id === person.id}
      disabled={disabled} onClick={event => open(person,event)}><Avatar person={person}/></Tappable>)}
  </div>;
  const person = circle.members.find(member => member.id === target?.id) || target;
  const scopedFailures = failures.filter(payload => payload.circleId === circle.id && payload.ledgerId === ledgerId);
  const targetFailures = target ? scopedFailures.filter(payload => payload.recipientId === target.id) : scopedFailures;
  return <>
    {railTarget && createPortal(people,railTarget)}
    {target && <Sheet title={person.name} className="emoji-sheet" style={sheetStyle} onClose={() => { setTarget(null); setOutgoing([]); }}>
      <div className="emoji-person-row"><span className="emoji-recipient" ref={targetPortrait}><Avatar person={person}/></span><div className="emoji-person-info"><strong>{person.name}</strong></div></div>
      <div className="emoji-drawer" role="group" aria-label={t('emojiChoices')}>{REACTION_EMOJIS.map(emoji => <Tappable Component="button" type="button" key={emoji} aria-label={t('sendEmoji',{emoji})} data-emoji={emoji} disabled={disabled} onClick={event => send(emoji,event.currentTarget)}>{emoji}</Tappable>)}<Tappable Component="button" type="button" className="emoji-custom-toggle" aria-label={t('customEmoji')} aria-expanded={customOpen} onClick={() => setCustomOpen(value => !value)}>⌨️</Tappable></div>
      {customOpen && <form className="emoji-custom" onSubmit={event => { event.preventDefault(); send(custom,event.currentTarget); }}>
        <input aria-label={t('customEmoji')} placeholder="☺︎" value={custom} maxLength={64} onChange={event => { setCustom(event.target.value); setInvalid(false); }}/>
        <Tappable Component="button" type="submit" disabled={!custom.trim() || disabled} aria-label={t('sendEmoji',{emoji:custom})}>↑</Tappable>
      </form>}
      {invalid && <span className="emoji-error" role="status">{t('errorReaction')}</span>}
      {targetFailures.length > 0 && <button type="button" className="emoji-retry" onClick={() => retryFailures(targetFailures)}>{t('reactionRetry',{n:targetFailures.length})}</button>}
    </Sheet>}
    {effectHost && createPortal(<div className="emoji-flight-layer" hidden={!visible}>
      {outgoing.map(event => <FlyingEmoji key={event.id} event={event} onFinish={finishOutgoing} visible={visible}/>)}
      <ReactionReception events={incoming} visible={visible} onSeen={markSeen} onFinish={finishIncoming}/>
    </div>,effectHost)}
    {!target && scopedFailures.length > 0 && <button type="button" className="emoji-retry emoji-retry-capsule" onClick={() => retryFailures(scopedFailures)}>{t('reactionRetry',{n:scopedFailures.length})}</button>}
  </>;
}
