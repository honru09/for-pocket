import React from 'react';

import avatarCustomize from '../public/assets/ui-kit-v1/candidates-v3/icons/avatar-customize-v1.svg';
import circleInvite from '../public/assets/ui-kit-v1/candidates-v3/icons/circle-invite-tactile-v1.svg';
import accountLink from '../public/assets/ui-kit-v1/candidates-v3/icons/account-link-tactile-v1.svg';
import privacyLocation from '../public/assets/ui-kit-v1/candidates-v3/icons/privacy-location-tactile-v1.svg';
import themeSwatch from '../public/assets/ui-kit-v1/candidates-v3/icons/theme-swatch-tactile-v1.svg';
import exportEnvelope from '../public/assets/ui-kit-v1/candidates-v3/icons/export-envelope-tactile-v1.svg';

const icons = {
  'avatar-customize-v1': avatarCustomize,
  'circle-invite-tactile-v1': circleInvite,
  'account-link-tactile-v1': accountLink,
  'privacy-location-tactile-v1': privacyLocation,
  'theme-swatch-tactile-v1': themeSwatch,
  'export-envelope-tactile-v1': exportEnvelope,
};

export default function CandidateIcon({ name, className = '' }) {
  const src = icons[name];
  if (!src) return null;
  return <img className={`candidate-icon${className ? ` ${className}` : ''}`} src={src} alt="" aria-hidden="true" width="24" height="24" loading="lazy" decoding="async" draggable="false" />;
}
