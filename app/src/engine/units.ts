/**
 * Canvas unit system.
 *
 * World coordinates map to real-world size: 100 world units = 1 inch,
 * which makes one major grid square (5 × 20px minor cells at the default
 * grid setting) exactly 1" × 1". Component symbols are scaled on load so
 * their physical width/height (from the library definition, in inches)
 * is honored on canvas. The grid-size slider only changes snap density.
 */
export const PIXELS_PER_INCH = 100;
