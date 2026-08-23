import React from 'react';
import { toSafeJsonLdString } from '../utils/jsonLd';

const SITE_ORIGIN = 'https://murzaktech.com';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Murzak Technologies Limited',
  url: SITE_ORIGIN,
  image: `${SITE_ORIGIN}/og-image.png`,
  description:
    "Nairobi's provider of custom software development, ERPNext implementation, and managed cloud hosting for East African businesses.",
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Nairobi',
    addressCountry: 'KE',
  },
  areaServed: 'KE',
  sameAs: [
    'https://www.linkedin.com/in/murzak-technologies-1774b63a9',
    'https://twitter.com/MurzakTech',
    'https://instagram.com/Murzaktechnologies',
  ],
};

const jsonLdString = toSafeJsonLdString(jsonLd);

/** Sitewide LocalBusiness structured data — mounted once in App.tsx, outside <Routes>. */
const OrganizationSchema: React.FC = () => (
  // eslint-disable-next-line react/no-danger
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString }} />
);

export default OrganizationSchema;
