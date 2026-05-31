---
title: "ui-ux-pro-max"
description: "Comprehensive UI/UX design intelligence with 67 styles, 96 palettes, 57 font pairings, 25 chart types across 13 technology stacks."
---

A comprehensive design guide for web and mobile applications. Contains 67 styles, 96 color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across 13 technology stacks. Provides priority-based recommendations for building accessible, performant, and visually polished interfaces.

> This Skill is vendored from [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT license).

## Trigger Conditions

- User asks to design UI components or pages
- User needs color palette or typography recommendations
- User asks for UX review of existing code
- Phase 2 (Product Design) is active and the product is GUI-based (Web / Mobile / Desktop)
- `product-designer` Skill automatically invokes this for visual design decisions

## Core Capabilities

### Design Actions

`plan` · `build` · `create` · `design` · `implement` · `review` · `fix` · `improve` · `optimize` · `enhance` · `refactor` · `check`

### Project Types

Website · Landing page · Dashboard · Admin panel · E-commerce · SaaS · Portfolio · Blog · Mobile app

### UI Elements

Button · Modal · Navbar · Sidebar · Card · Table · Form · Chart

### Technology Stacks (13)

React · Next.js · Vue · Nuxt · Svelte · SvelteKit · SwiftUI · React Native · Flutter · Tailwind CSS · shadcn/ui · HTML/CSS · Astro

## Rule Categories by Priority

| Priority | Category | Impact |
|----------|----------|--------|
| 1 | Accessibility | CRITICAL |
| 2 | Touch & Interaction | CRITICAL |
| 3 | Performance | HIGH |
| 4 | Layout & Responsive | HIGH |
| 5 | Typography & Color | MEDIUM |
| 6 | Animation | MEDIUM |
| 7 | Style Selection | MEDIUM |
| 8 | Charts & Data | LOW |

## Key Guidelines

### Accessibility (CRITICAL)

- Minimum 4.5:1 color contrast ratio for normal text
- Visible focus rings on all interactive elements
- Descriptive alt text for meaningful images
- `aria-label` for icon-only buttons
- Tab order matches visual order
- Form labels with `for` attribute

### Touch & Interaction (CRITICAL)

- Minimum 44×44px touch targets
- Use click/tap for primary interactions (not hover-only)
- Disable buttons during async operations
- Clear error messages near the problem source
- `cursor: pointer` on clickable elements

### Performance (HIGH)

- Use WebP, `srcset`, and lazy loading for images
- Check `prefers-reduced-motion` before animating
- Reserve space for async content to prevent layout shift

### Layout & Responsive (HIGH)

- `viewport` meta: `width=device-width, initial-scale=1`
- Mobile-first breakpoints
- Flexible grids with `min()` / `clamp()`

## Style Database (67 styles)

Includes: Glassmorphism · Claymorphism · Minimalism · Brutalism · Neumorphism · Bento Grid · Dark Mode · Skeuomorphism · Flat Design · Material Design · and 57 more.

Each style entry includes: description, CSS properties, best-for project types, and example code.

## Color Palettes (96 palettes)

Organized by mood: Professional · Creative · Playful · Serious · Warm · Cool · Neutral · Bold.

Each palette includes: primary, secondary, accent, background, and text colors with hex values and WCAG contrast validation.

## Font Pairings (57 pairings)

Curated heading + body combinations with Google Fonts links, fallback stacks, and recommended use cases.

## Chart Types (25 types)

Bar · Line · Pie · Donut · Area · Scatter · Radar · Treemap · Heatmap · Sankey · and 15 more.

Each chart type includes: when to use, data requirements, accessibility notes, and library recommendations per stack.

## Integration with OpenLogos

During Phase 2 (Product Design), when the `product-designer` Skill encounters a GUI-based product:

1. `product-designer` automatically references `ui-ux-pro-max` for visual decisions
2. Style, palette, and typography choices are recorded in the feature spec
3. These choices carry forward into Phase 3 code generation as design constraints

## Related Skills

- [`product-designer`](/skills/product-designer) — Invokes this Skill for GUI products during Phase 2
- [`code-implementor`](/skills/code-implementor) — Applies the design decisions when generating frontend code
