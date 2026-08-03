# Magic Wand — What It Does and What It's Made Of

The Magic Wand is a single-click annotation tool: the user has already spotted
something (a rivet, a crack, a dent, anything worth flagging) and clicks once
on it. The tool grows a region starting from that click and draws a box
around it. That's the whole interaction — one click in, one box out. It is
**not** a whole-photo scanner and never triggers on its own; nothing happens
until the user clicks.

There are two interchangeable engines behind that one click, selectable from
the **Engine** dropdown next to the Magic Wand toggle. Both take the same
input (a click point) and produce the same output (a box) - they just decide
"what belongs in this region" differently.

---

## Engine 1 — Classical (colour flood-fill)

**What it does:** starts at the clicked pixel and grows outward to
neighbouring pixels, one pixel at a time, stopping once it hits something
that doesn't belong. No model, no download, no network access of any kind -
it's plain arithmetic over the pixels already sitting in the browser's
memory. Runs in a Web Worker so it never freezes the UI, and typically
finishes in well under a second even on a large photo.

A pixel is added to the growing region if it's similar enough to the clicked
pixel on **any** of three measures:

1. **Colour** - is this pixel roughly the same colour as the one clicked?
   This is the classic "paint bucket" test and is enough on its own for a
   solid-coloured object on a contrasting background.
2. **Gradient** - does this pixel sit in similarly strong, similarly-oriented
   edge activity as the clicked area? This lets the fill continue across an
   anti-aliased or textured edge (a rivet's rim, a crack's outline) where the
   raw colour drifts pixel-to-pixel but the "this is an edge" character stays
   consistent.
3. **Shading** - does this pixel's immediate neighbourhood have similarly
   variable brightness as the clicked area? This lets the fill continue
   across a smooth shading gradient (a dent's shaded basin) that a tight
   colour-only rule would stop at partway through.

Cues 2 and 3 only switch on when the clicked area itself shows a real amount
of that signal - two different flat, textureless colours both look like "no
edge, no variance," so without that gate the fill could leak across any
flat-to-flat colour boundary.

Once growth stops, the region's orientation is computed (via PCA - which way
is it "longest") and the box is fit tightly along that orientation, not
just squared off to the image's own left-right/up-down axes - important for
anything photographed at an angle.

**Good for:** clean, click-and-go annotation with zero setup cost, zero
download, and completely predictable, inspectable behaviour. The default
choice, and the one to reach for first.

**Full algorithm write-up:** see `MAGIC-DETECTION.md` in this folder.

---

## Engine 2 — AI Model (SAM point-prompt)

**What it does:** sends the click point to a real segmentation model -
Meta's **Segment Anything Model (SAM)** - running entirely inside the
browser. SAM was trained on over a billion masks and generalizes to objects
and materials it's never specifically seen, so it can pick up on real visual
boundaries a pixel-similarity rule can't reason about (reflections,
compression artefacts, subtle material changes). The model returns a handful
of candidate masks per click along with its own confidence in each one; this
app picks whichever candidate is smallest among the ones it's reasonably
confident in (see "Note on model behaviour" below for why), converts that
mask's outline to a box the same way the classical engine does (PCA
orientation + a tight fit along that orientation), and hands it back.

The first click after switching to this engine costs a few extra seconds (or
longer on a slow connection) to download the model - after that it's cached
and every use, even after closing the browser, starts warm. Segmenting the
*first* photo after that download also costs a moment (the model has to
"read" the whole image once); every subsequent click on the *same* photo is
fast, since only the point-decoding step re-runs.

### Which model - three choices

All three are picked from the **Model** dropdown. They're all the same
underlying architecture (SAM); they differ only in how much of the original
model survived compression on the way to running in a browser.

| Model | What it is | Size / speed | Quality |
|---|---|---|---|
| **SlimSAM 50% pruned** (default) | SAM with 50% of its parameters pruned away and the rest re-trained to compensate (see below) | Medium download, medium speed | Best of the two SlimSAM options |
| **SlimSAM 77% pruned** | Same technique, more aggressively pruned | Smallest/fastest of the three | Lower quality than 50% - masks are shakier on subtle features |
| **SAM ViT-Base (full model)** | The original, un-pruned SAM | Largest download, slowest to run in-browser | Best available - this is the actual published model, not a compressed stand-in |

Note the naming: "50%" and "77%" are how much of the model was **removed**,
not kept - the 77% option is the smaller and less accurate of the two, even
though the number is bigger. Worth double-checking if you ever add another
SlimSAM checkpoint by name alone.

**SlimSAM**, specifically, comes from the paper *"SlimSAM: 0.1% Data Makes
Segment Anything Slim"* ([arXiv:2312.05284](https://arxiv.org/abs/2312.05284)).
It compresses SAM by alternating between pruning distinct sub-structures of
the model and distilling knowledge back into what's left, using only about
0.1% of the data SAM itself was originally trained on. Its whole point is
"almost as good as SAM, a fraction of the size" - which is exactly why it's
the default here rather than the full model.

**Good for:** subtle or ambiguous boundaries the classical engine's pixel
rules can't reason about - low-contrast damage, reflective surfaces,
anything where "what counts as the same object" needs real visual
understanding rather than local pixel statistics.

### Privacy - does anything leave the browser?

**The image never does.** Inference runs entirely client-side via
`@huggingface/transformers` on top of ONNX Runtime Web (WebAssembly) - the
photo, the click coordinates, and the resulting mask all stay in the
browser's memory the whole time. There is no server component to any of
this; nothing in this app's code sends image data, click positions, or
results anywhere.

The one real network activity is the **model download itself**: the first
time a given checkpoint is used, its weight files are fetched from Hugging
Face's CDN (a few tens of MB, depending on which of the three above is
chosen). That request reveals to Hugging Face that *some browser* downloaded
*this particular model file* (ordinary CDN request metadata - IP address,
timestamp - the same as fetching any public file) but carries none of the
user's photo or annotation data. After that first download, the browser's
Cache API keeps the weights locally, so every use afterward - including
after closing and reopening the browser - needs no network access at all.

### Licensing - free to use commercially?

Yes, for all three. SAM itself, and both SlimSAM checkpoints, are published
under the **Apache 2.0** license - permissive, allows commercial use,
modification, and redistribution, with no royalty and no requirement to
open-source anything built on top of it (it only asks that copyright/license
notices be preserved). Verified directly against each model's Hugging Face
listing, not assumed from the base model's license.

### Note on model behaviour: why "smallest confident mask," not "most confident mask"

SAM proposes several candidate masks per click (roughly: whole object / part
/ subpart) with its own predicted confidence for each. Left to its own
ranking, SAM tends to favour the largest, most unambiguous boundary - on a
mostly-uniform surface, that's often the whole panel, not the small local
feature actually clicked on. This app overrides that ranking: among
candidates SAM is at least reasonably confident about, it picks the
**smallest** one, since "the one specific thing you clicked on" is what this
tool is for. If nothing clears that confidence bar, it falls back to SAM's
own top pick rather than returning nothing. This is a deliberate override of
the model's default behaviour, not a limitation of SAM itself - worth
knowing if a click ever produces a smaller or larger box than expected.

---

## Choosing between them

| | Classical | AI Model (SAM) |
|---|---|---|
| Setup cost | None | Model download on first use (cached after) |
| Speed | Near-instant | Fast after first photo/click; a moment slower on the very first |
| Network/privacy | Fully offline, zero network use | Model weights fetched once from Hugging Face; image data never leaves the browser |
| Best at | Solid colours, clean edges | Subtle/ambiguous boundaries, materials pixel rules can't reason about |
| Cost to use | Free, no license concerns (your own code) | Free, Apache 2.0 licensed models |

Both are one click, one box, and both are safe defaults to leave switched on
- the choice is really "does this photo's defect have a clean colour/edge
boundary, or does it need real visual judgment to see?"
