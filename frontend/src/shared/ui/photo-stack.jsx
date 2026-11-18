import { useState } from "react";

import { Button } from "./button";

/** Places en éventail par rang : dessus, puis alternance droite / gauche. */
const PLACES = [0, 1, -1, 2, -2];

/**
 * Pile de photos en éventail. On renumérote `--i` (rang) et `--p` (place) sans
 * déplacer les nœuds : les transitions CSS jouent. Flèches gauche / droite au
 * clavier, carte du dessus seule interactive (les autres sont `inert`).
 *
 * `photos: [{ src, alt, caption, width, height }]`
 */
export function PhotoStack({ photos, label, nextLabel = "Carte suivante" }) {
  const [order, setOrder] = useState(() => photos.map((_, k) => k));
  const [announce, setAnnounce] = useState("");
  const n = photos.length;

  const move = (forward) => {
    setOrder((current) => {
      const next = forward ? [...current.slice(1), current[0]] : [current[n - 1], ...current.slice(0, n - 1)];
      const top = photos[next[0]];
      setAnnounce(`Photo ${next[0] + 1} sur ${n} : ${top.caption}`);
      return next;
    });
  };

  return (
    <div className="pile">
      <div
        className="pile-stack"
        tabIndex={0}
        role="group"
        aria-roledescription="pile de photos"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(true);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(false);
          }
        }}
      >
        {photos.map((photo, index) => {
          const rank = order.indexOf(index);
          return (
            <figure
              key={photo.src}
              className="pile-card"
              style={{ "--i": rank, "--p": PLACES[rank] ?? 0 }}
              data-top={rank === 0 ? "" : undefined}
              inert={rank === 0 ? undefined : ""}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading={index ? "lazy" : undefined} decoding="async" />
              <figcaption>{photo.caption}</figcaption>
            </figure>
          );
        })}
      </div>
      <div className="pile-bar">
        <Button variant="secondary" className="sur-marine pile-next" onClick={() => move(true)}>
          {nextLabel}
        </Button>
        <span className="pile-count" aria-hidden="true">
          {order[0] + 1} / {n}
        </span>
      </div>
      <p className="sr-only pile-live" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
