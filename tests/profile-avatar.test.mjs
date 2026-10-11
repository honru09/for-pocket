import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCustomAvatar, validateUserProfile } from '../public/shared.mjs';
import { AVATAR_MAX_DATA_URL_LENGTH, AVATAR_MAX_DIMENSION, isAvatarImageType, isBoundedAvatarDataUrl } from '../src/avatar-image.mjs';

const png = 'data:image/png;base64,' + 'i'.repeat(32);

test('profile avatars accept bounded image data and keep built-in avatars', () => {
  assert.equal(isCustomAvatar(png), true);
  assert.equal(validateUserProfile({ name: 'Kojun', color: 'blue', avatar: png }).avatar, png);
  assert.equal(validateUserProfile({ name: 'Kojun', color: 'blue', avatar: 'cloud' }).avatar, 'cloud');
});

test('profile avatars reject non-image data and oversized payloads', () => {
  assert.equal(isCustomAvatar('data:text/html;base64,PGh0bWw+'), false);
  assert.throws(() => validateUserProfile({ name: 'Kojun', color: 'blue', avatar: 'data:text/html;base64,PGh0bWw+' }));
  assert.equal(isCustomAvatar('data:image/png;base64,' + 'A'.repeat(256 * 1024)), false);
});

test('avatar image preparation keeps the browser input contract bounded', () => {
  assert.equal(AVATAR_MAX_DIMENSION, 256);
  assert.equal(AVATAR_MAX_DATA_URL_LENGTH, 256 * 1024);
  assert.equal(isAvatarImageType('image/jpeg'), true);
  assert.equal(isAvatarImageType('image/svg+xml'), false);
  assert.equal(isBoundedAvatarDataUrl('data:image/webp;base64,' + 'A'.repeat(32)), true);
  assert.equal(isBoundedAvatarDataUrl('data:image/webp;base64,' + 'A'.repeat(AVATAR_MAX_DATA_URL_LENGTH)), false);
});
