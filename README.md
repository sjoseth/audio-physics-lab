# Audio Physics Lab 1.0 (Beta) 🎧

**Real-time acoustic simulation and optimization suite running 100% in your browser.**

Audio Physics Lab helps audiophiles and engineers optimize their room layout using physics-based simulation. No installation required, no data uploaded to the cloud.

🚀 **Live Demo:** [Sett inn URL her]

---

## ✨ Key Features

The application is divided into specialized modules for different acoustic tasks:

### 1. 🏠 Room Mode Simulator
Visualize standing waves (eigenmodes) in rectangular rooms.
* **Features:** Heatmap generation for optimal subwoofer placement.
* **Analysis:** Shows axial, tangential, and oblique modes.
* **Target:** Compare response against Harman curves (+3dB to +12dB).

### 2. 🔊 Speaker Placement (L.O.T.S.)
Optimize stereo imaging and reduce SBIR (Speaker Boundary Interference Response).
* **Heatmaps:** "Goodness" map combining geometric symmetry and frequency response.
* **Guides:** Overlays for "Rule of Thirds" and "Cardas Method".
* **Real-time:** Drag speakers and see frequency response update instantly.

### 3. ⚡ Reflection Tracker
Identify first reflection points for acoustic treatment.
* **Ray Tracing:** Calculates paths from speakers to side, front, and back walls.
* **Delay & Attenuation:** Shows precise time delay (ms) and attenuation (dB) relative to direct sound.

### 4. ⏱️ Time Alignment
Ensure perfect phase integration between mains and subwoofers.
* **Calculator:** Automatically computes distance and necessary delay (ms) based on speaker positions.
* **Phase Check:** Recommends polarity settings (0° vs 180°) at the crossover frequency.

### 5. 🎛️ PEQ Generator (Auto EQ)
Generate Parametric EQ filters to correct room anomalies.
* **Auto-Calculation:** Identifies peaks and dips and generates generic Biquad filter coefficients (Freq, Gain, Q).
* **Export:** One-click copy of filter parameters for use in DSPs (MiniDSP, Roon, EqualizerAPO).

---

## 🛠️ Tech Stack

* **Core:** Vanilla JavaScript (ES6+)
* **Rendering:** HTML5 Canvas API (2D Context)
* **Styling:** Tailwind CSS
* **Charts:** Chart.js
* **State Management:** Custom LocalStorage implementation

## 🚀 Running Locally

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/din-bruker/audio-physics-lab.git](https://github.com/din-bruker/audio-physics-lab.git)