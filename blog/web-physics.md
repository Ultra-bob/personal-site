---
title: Physics on the web
description: Something other than Three.js
pubDate: 2026-04-18
updatedDate: 2026-05-07
---

## Inspiration

When creating my personal site, I was thinking about how to make it different from every other personal website. I playing [Space Engineers 2](https://2.spaceengineersgame.com/) at the time, mainly downloading pre-designed ships from the Steam Workshop, and destroying them in new and interesting ways. Like any kid playing Minecraft in creative mode, the first thing most people gravitate towards in creative sandboxes is creating chaos from order.

To channel that, and add some interactivity to my site, I decided to add a physics simulation to some page elements. This would allow visitors to toss them around like toy blocks, destroying the carefully created layout. The more creatively inclined could also re-stack the blocks in any way they desired. Even though most users probably wouldn't stay here long, I hoped to create a _"wait, you can do that?!"_ moment.

## Implementation

After poking around for a while, I settled on [p2-es](https://p2-es.pmnd.rs/) to power the physics simulation. I chose it over the much more popular [Matter.js](https://brm.io/matter-js/docs/) mainly since it had a ~30% smaller bundle size.

Most web physics demos use canvas elements for rendering, but I wanted the physics elements to look and behave like regular web elements when not in motion, which would have been very difficult using canvas. The new [HTML-in-Canvas API](https://github.com/WICG/html-in-canvas) looks like exactly what I need, but it's behind a feature flag in Chrome, and not even close to baseline available. So, setting custom `transform` properties on DOM elements it is.

The main flow looks something like this:

1. Find all the elements with the `box` class, and create a physics object with their position and size
2. Create physics objects for the borders of the page
3. Every frame:
   1. Step the physics simulation
   2. Update the `transform` of each DOM element based on it's physics simulation body

There are also some extra features I added for polish:

- **Mouse interaction:** Implemented with a kinematic body that follows a mouse, and creating physics joints between it and the object being dragged.
- **Simulation Settling:** Runs a few hundred simulation steps on the page load, so the visitor doesn't see objects just falling into place, but objects that seem to have always been there.
- **Collision Sounds:** A satisfying _thunk_ sound that scales in volume automatically based on collision velocity.
- **Resizable Borders:** When the browser viewport resizes, the border planes automatically update; Try it by opening the developer console or resizing your browser.

For all the details, you can read the [source code](https://code.ultrablob.me/ultrablob/personal-site/src/branch/main/src/lib/physics.ts).

## Results

I'm reasonably happy with how it ended up turning out, especially on the blog index page. Although there's only one blog post up as of publication, it's quite fun when there are several to throw around. On the homepage, I wish there were more elements, and hope to improve that later.

In terms of performance, the CPU cost is surprisingly minimal with good optimizations (some of which I probably missed). On Chrome's low-tier mobile chip throttling, the simulation settles just under a second after the page load, and in ~200ms on mid-tier mobile. With no throttling, it is basically instant on my desktop PC.

*Update: with better optimizations, the simulation now loads in 100ms on low-tier mobile and 40ms on mid-tier mobile.*

The network impact is more of a mixed bag. It pains me that 80% of my bundle size is the physics simulation, and that it blocks most of the content on my homepage. However, even on Chrome's "Slow 4G" network throttling, the page fully loads in ~2 seconds, and it loads in ~0.5s on "Fast 4G". This probably could be improved by reducing the network request chain length.

*Update: By reducing network waterfall, the page fully loads in ~1.5s on "Slow 4G", but about the same on "Fast 4G".*

Overall, I think the performance hit is acceptable for the benefits it brings to the site, and should be reducible with future optimization work.
