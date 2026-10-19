import { AnimatePresence, motion } from "motion/react";
import { dismissTour } from "../state/store";

// First-use three-step tour: country, building, history. Skippable and
// shown again only on request.
export default function Tour({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="DevWorld tour"
          className="dw-sheet"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            position: "absolute",
            left: 68,
            top: 12,
            zIndex: 20,
            maxWidth: 300,
            padding: 14,
          }}
        >
          <h2 style={{ fontFamily: "var(--dw-font-display)", margin: "0 0 6px" }}>
            Three steps to your world
          </h2>
          <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li>Pick a country to descend through states and districts.</li>
            <li>Open a building to inspect its floors and rooms.</li>
            <li>Scrub the Chronoscope to rewind real history.</li>
          </ol>
          <button
            type="button"
            className="dw-btn active"
            onClick={() => {
              dismissTour();
              onDone();
            }}
          >
            Start exploring
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
