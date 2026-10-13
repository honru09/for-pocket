import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWeather, createWeatherClient, isWeatherDay, mascotEnvironment, weatherCell } from '../src/weather.mjs';

test('classifies the common WMO weather groups for the mascot', () => {
  assert.equal(classifyWeather(0), 'sun');
  assert.equal(classifyWeather(3), 'cloudy');
  assert.equal(classifyWeather(45), 'fog');
  assert.equal(classifyWeather(63), 'rain');
  assert.equal(classifyWeather(73), 'snow');
  assert.equal(classifyWeather(95), 'storm');
});

test('severe precipitation wins over wind, while clear windy weather gets a leaf', () => {
  assert.equal(classifyWeather(61, 20), 'rain');
  assert.equal(classifyWeather(0, 10), 'wind');
  assert.equal(classifyWeather(3, 12), 'wind');
  assert.equal(classifyWeather(0, 9.99), 'sun');
});

test('unknown or malformed weather quietly falls back to the plain cloud', () => {
  assert.equal(classifyWeather(undefined), null);
  assert.equal(classifyWeather('not-a-code', 40), null);
  assert.equal(classifyWeather(999), null);
});

test('normalizes Open-Meteo day flag without coercing missing values', () => {
  assert.equal(isWeatherDay(1), true);
  assert.equal(isWeatherDay('0'), false);
  assert.equal(isWeatherDay(null), null);
  assert.equal(isWeatherDay(undefined), null);
});

test('weather cells smooth GPS jitter and environment keeps severe weather visible at night', () => {
  assert.equal(weatherCell({ lat:35.68951, lng:139.70051 }), '35.69,139.70');
  assert.equal(weatherCell({ lat:91, lng:139 }), null);
  assert.equal(mascotEnvironment({ kind:'rain', isDay:false }, new Date('2026-10-13T23:00:00Z'), 'Asia/Tokyo'), 'rain');
  assert.equal(mascotEnvironment({ kind:'sun', isDay:true }, new Date('2026-10-13T03:00:00Z'), 'Asia/Tokyo'), 'sun');
  assert.equal(mascotEnvironment(null, new Date('2026-10-13T14:00:00Z'), 'Asia/Tokyo'), 'night');
});

test('weather client caches a cell and quietly handles a failed provider', async () => {
  let calls = 0;
  const client = createWeatherClient({ now:() => 10_000, fetch:async () => {
    calls += 1;
    return { ok:true, async json() { return { current:{ weather_code:73, is_day:1, wind_speed_10m:2 } }; } };
  } });
  const first = await client.load({ lat:35.6895, lng:139.7005 });
  const second = await client.load({ lat:35.6896, lng:139.7006 });
  assert.deepEqual(first, { kind:'snow', isDay:true });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  const broken = createWeatherClient({ fetch:async () => { throw new Error('offline'); } });
  assert.equal(await broken.load({ lat:35, lng:139 }), null);
});
