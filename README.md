# Learning Vector Quantization (LVQ) — Interactive Visualization

An interactive web page that shows how the **LVQ algorithm** learns, one step at a time.

Made for **Soft Computing (IA1)**, TY B.Tech — Artificial Intelligence & Data Science,
KJ Somaiya School of Engineering.

**Submitted by**

| Name | Roll No. |
| --- | --- |
| Bijeet Nayek | 16014224081 |
| Vini Pandhare | 16014224085 |

---
## Live Demo

Open either link in a browser — nothing to download or install.

| Hosted on | Link |
| --- | --- |
| **Vercel** | https://lvq-sc-ia1.vercel.app |
| **GitHub Pages** | https://bijeetnayek0409.github.io/Learning-Vector-Quantization-SC-IA1/ |

Both links open the same project.

## Demo Video

**Google Drive link:** https://drive.google.com/file/d/10GX81zuSJ9ooSwbnSpXagvDD9l98khSj/view

---

## About the project

LVQ is usually taught only with formulas, so it is hard to picture what is actually happening
during training. We built a web page that draws it on screen instead.

The graph shows the training data as small dots and the prototypes as large diamonds. When you
press **Next Step**, the page shows one operation of the algorithm at a time and prints the
calculation on the side, so the formula and the picture always match.

The prototypes start in the wrong positions in the middle of the graph. As training runs, they
move into their own class and the accuracy goes up from about **32%** to **100%** on the default
dataset.

## How LVQ works

For each training sample:

1. Find the distance from the sample to every prototype.
2. The nearest prototype wins (Best Matching Unit).
3. If the winner has the **same** class as the sample, move it **toward** the sample.
4. If the winner has a **different** class, move it **away** from the sample.
5. Repeat for all samples, for the given number of epochs.

A new point is then given the class of whichever prototype is nearest.

**Formulas used**

```
Distance        D(x, w) = √ Σ (xi − wi)²

Correct class   w(t+1) = w(t) + α(t) [ x(t) − w(t) ]

Wrong class     w(t+1) = w(t) − α(t) [ x(t) − w(t) ]
```

where `x` = input vector, `w` = prototype vector, `α` = learning rate, `t` = current iteration.

The class label is what decides the sign. That is what makes LVQ **supervised**, and what
separates it from K-Means clustering.

## Features

- Step-by-step training — every click shows one part of the algorithm
- Buttons for Next Step, Previous Step, Play, Pause, Train 1 Epoch and Train All
- Four datasets — separated clusters, overlapping clusters, concentric rings, and a custom
  mode where you draw your own points
- Settings for classes, training points, prototypes, learning rate, decay, epochs and speed
- Decision regions showing which class each area of the graph belongs to
- A side panel that prints the distances, the winner, the class comparison and the final
  formula with real numbers filled in
- Distance bars showing how far the input is from every prototype
- Before / After comparison of the prototype positions and accuracy
- Click anywhere on the graph to classify a new point
- Live charts for accuracy and prototype movement per epoch
- Theory section and 15 viva questions with answers
- Light and dark theme, presentation mode, and keyboard shortcuts

## How to run

No installation and no internet needed.

1. Download or clone this repository.
2. Open **`index.html`** in any browser.

```bash
git clone https://github.com/BijeetNayek0409/Learning-Vector-Quantization-SC-IA1.git
cd Learning-Vector-Quantization-SC-IA1
open index.html          # on Windows: start index.html
```

**Keyboard shortcuts**

| Key | Action |
| --- | --- |
| `→` | Next step |
| `←` | Previous step |
| `Space` | Play / pause |
| `R` | Reset |

## Project structure

```
├── index.html              page structure, controls and all written content
├── style.css               design, layout, light and dark themes
└── js/
    ├── lvq.js              the LVQ algorithm — distance, winner, update rule, accuracy
    ├── dataset.js          creates the data points for the different datasets
    ├── animation.js        the six-step engine, play and pause
    ├── visualization.js    draws the graph, prototypes, lines and arrows
    ├── charts.js           draws the two small charts
    ├── metrics.js          updates the numbers and the explanation panel
    ├── ui.js               buttons, sliders, tabs and keyboard keys
    └── main.js             starts the program and joins the files together
```

The algorithm is kept in `js/lvq.js` on its own, away from the drawing code. The arrows drawn
on the graph use the real before and after positions from each update, so the animation shows
the actual calculation and not a fixed effect.

## Technologies used

- **HTML** — structure of the page
- **CSS** — design, layout and themes
- **JavaScript** — the algorithm and all the controls
- **HTML5 Canvas** — drawing the graph and the charts
- **SVG** — one small diagram in the theory section

No framework or library is used. Everything is written by us, so the project runs offline and
every line can be explained.

## Screenshots

*(Add screenshots here)*

| Before training | After training |
| --- | --- |
| | |

## References

1. T. Kohonen, *Self-Organizing Maps*, Springer.
2. S. Haykin, *Neural Networks and Learning Machines*, Pearson.
3. Scikit-learn Documentation — https://scikit-learn.org/
4. GeeksforGeeks, "Learning Vector Quantization" — https://www.geeksforgeeks.org/
5. IBM, "What is Machine Learning?" — https://www.ibm.com/topics/machine-learning
