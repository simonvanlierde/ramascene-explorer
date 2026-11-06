# Accessibility statement

This page covers RaMa-Scene Explorer at
[simonvanlierde.com/ramascene-explorer](https://simonvanlierde.com/ramascene-explorer/).
Simon van Lierde builds RaMa-Scene Explorer and is responsible for this page.

## Using RaMa-Scene Explorer

You can:

- choose a country, an indicator and the sectors with only a keyboard: the sector list is one
  Tab stop, and the arrow keys move inside it;
- open Details and the "where these numbers come from" note with the keyboard, and close them
  with Escape, which puts the focus back on the control that opened them;
- read the flows the map draws as a table, in Details → Table;
- use a dark theme, which follows your device's setting until you pick one in the header;
- turn off the moving replay in What if…: with reduced motion set on your device, it jumps
  straight to the result;
- use it on a phone, where the page does not scroll sideways.

## How accessible RaMa-Scene Explorer is

RaMa-Scene Explorer aims to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA, the usual
standard for accessible websites.

Its conformance is **not assessed**: nobody has checked RaMa-Scene Explorer against every WCAG 2.2
rule yet. Simon van Lierde runs the checks below. No outside expert has tested it.

## Known problems

None that we know of yet. The map and the Sankey diagram are pictures of the numbers; the table
in Details holds the same flows as text.

## Tell us about a problem

If any part of RaMa-Scene Explorer is hard or impossible for you to use,
[open an issue](https://github.com/simonvanlierde/ramascene-explorer/issues/new/choose). Tell us
what you tried to do, what happened, and which browser and assistive technology you use, if any.

We'll reply within 10 working days. If you need something from RaMa-Scene Explorer in another
format, ask and we'll send it.

## How we check

These automatic checks run on every proposed change to RaMa-Scene Explorer:

- [axe-core](https://github.com/dequelabs/axe-core) scans the map, Details, the phone's selection
  sheet, the source note and the custom scenario form for WCAG 2.0, 2.1 and 2.2 level A and AA
  problems, in the light and the dark theme.
- The same tests run in Chromium, Firefox and WebKit (the engine Safari uses), on desktop and
  phone screen sizes.
- Tests drive the sector list, the country box, Details and the source note with the keyboard,
  and check where the focus goes when a panel closes.

Automatic tools find only some problems, so passing them doesn't mean there are none. The tests
are in [tests/e2e](https://github.com/simonvanlierde/ramascene-explorer/tree/main/tests/e2e).

Simon van Lierde tried the explorer by touch on an iPhone and an Android phone on 4 November 2026.
Nobody has tested it by hand with only a keyboard or with a screen reader yet.
RaMa-Scene Explorer needs HTML, CSS and JavaScript to work.

## About this statement

Prepared: 6 November 2026

Last reviewed: 6 November 2026

Next review: within 12 months of the last review, or at the next major release if that comes first.

Method: self-assessment, using the checks under How we check.
