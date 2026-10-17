export const brandImages = { logo: '/svbt-logo.jpg', facade: '/svbt-facade.jpg' };
export const phone = { display: '(844) 824-SVBT', href: 'tel:+18448247828' };
export const defaultSite = { headerBanner: 'INDEPENDENT LOCAL DEMONSTRATION', footerText: 'A perspective for the next economy.', heroTitle: 'Built for what comes next.', heroSubtitle: 'Ambitious ideas deserve a thoughtful financial foundation. Explore a banking experience shaped around the people building tomorrow.' };
// Server values replace defaults only when they are non-empty strings, so a failed or partial response never blanks the page.
export function mergeSite(data) {
  const result = { ...defaultSite };
  if (data && typeof data === 'object') for (const key of Object.keys(defaultSite)) if (typeof data[key] === 'string' && data[key].trim()) result[key] = data[key];
  return result;
}
// Image is shown until it errors; a missing brand file simply results in the text-only variant.
export function showImage(failed, key) { return !failed?.[key]; }
