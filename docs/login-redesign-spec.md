# Login Redesign Specification

## Goals
- Reduce copy density by ~60% while preserving all auth flows.
- Improve first-scan clarity with stronger hierarchy.
- Keep all existing features: sign in, create account, first login, reset password.
- Maintain WCAG 2.1 AA friendly contrast and focus visibility.

## Pain Points Found
- Hero messaging was too verbose and consumed vertical space.
- Form mode controls looked like independent buttons instead of a unified selector.
- Card rhythm had uneven spacing between heading, controls, and fields.
- Visual weight between hero and auth panel was inconsistent.

## New Information Architecture
- Left panel: concise value proposition + quick trust chips + supportive links.
- Right panel: primary action area with compact mode selector and single active form.
- Progressive disclosure retained: OTP fields/actions only appear after code send.

## Wireframes / Mockups
- Desktop wireframe: [login-wireframe-desktop.svg](file:///c:/Users/hp/Desktop/cribmatch-website/docs/login-wireframe-desktop.svg)
- Mobile wireframe: [login-wireframe-mobile.svg](file:///c:/Users/hp/Desktop/cribmatch-website/docs/login-wireframe-mobile.svg)

## Visual System
- **Colors**
  - Page base: `#020617`
  - Card surface: `#111827` with translucent overlays
  - Primary accent: `#34D399`
  - Secondary text: `#CBD5E1`
  - Focus ring: emerald tint with visible 2px ring behavior
- **Typography**
  - Headline: semibold, compact line-height, 4xl desktop / xl mobile
  - Section headers: 2xl desktop / xl mobile
  - Body: sm with relaxed line-height
  - Controls: xs–sm for compact readability
- **Spacing**
  - Global container gaps: 20–24px
  - Card padding: 16px mobile, 24px desktop
  - Form element vertical rhythm: 12px
  - Mode selector internal spacing: 6px
- **Elevation**
  - Soft shadow stack on auth card for depth on dark background
  - Subtle backdrop blur for panel separation

## Responsive Behavior
- **Desktop (≥1024px)**: two-column split (value panel + auth panel).
- **Tablet (768–1023px)**: stacked panels with preserved spacing rhythm.
- **Mobile (<768px)**: value panel simplified, auth panel prioritized.
- Form controls remain full-width and touch-safe at all breakpoints.

## Accessibility Notes
- Contrast ratios remain high on dark surfaces.
- Focus states retained via border + ring states on all inputs/buttons.
- Mode switch includes tab semantics (`role="tablist"`, `role="tab"`, `aria-selected`).
- Motion effects are minimal and non-blocking.

## Functional Integrity
- Existing OTP send/verify behaviors remain unchanged.
- Existing “request new code” and “change number” behaviors remain intact.
- Callback routing and auth API integration unchanged.
