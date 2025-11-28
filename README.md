# Audio Physics Lab 🔊

Audio Physics Lab is a free, privacy-focused web application for simulating and visualizing room acoustics.

The tool runs 100% in the browser (client-side) and helps you with:

* **Room Mode Simulator:** Visualize standing waves and find optimal subwoofer placement using heatmaps.
* **Speaker Placement:** Optimize stereo imaging and avoid SBIR (Speaker Boundary Interference Response) using the L.O.T.S. method.
* **Reflection Tracker:** Locate first reflection points for acoustic panel placement using Ray Tracing.
* **Time & Phase Aligner:** Calculate precise delay settings (ms) for perfect subwoofer integration.

🔗 **Try the app here:** https://audio-physics-lab.netlify.app

## 🛠️ Tech Stack

The project is built with pure "Vanilla" JavaScript, HTML5 Canvas, and Tailwind CSS. No frameworks, no backend, no tracking.

* **Canvas API:** For real-time rendering of rooms and graphs.
* **Tailwind CSS:** For styling and responsiveness.
* **Chart.js:** For frequency response graphs.

## 🚀 Get Started Locally

Since this is a static site, running it locally is very simple:

1. **Clone the repo:**
   git clone https://github.com/YOUR_USERNAME/audio-physics-lab.git
   cd audio-physics-lab

2. **Run with Live Server:**
   If you are using VS Code, install the "Live Server" extension and click "Go Live" in the bottom right corner.

   *Alternatively using Python:*
   python3 -m http.server

3. **Open in browser:**
   Go to http://localhost:5500 (or the port chosen by your server).

## 🤝 Contribute

Found a bug? Have an idea for a new feature?
Feel free to open an Issue or submit a Pull Request!

## 📄 License

This project is licensed under the [MIT License](LICENSE).