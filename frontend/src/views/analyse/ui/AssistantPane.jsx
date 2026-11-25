import { useEffect, useRef, useState } from "react";

import { AnswerStatus, askAssistant, citationParts, sourceOrigin, validateQuestion } from "@/entities/assistant";
import { detectionType } from "@/entities/detection";
import { toAppError } from "@/shared/api";
import { Icon } from "@/shared/ui";

import { pct } from "@/widgets/analysis-workspace";

/**
 * Assistant documentaire (sprint 9).
 * - En démonstration : les réponses de la maquette, sources fictives, sans
 *   appel au serveur.
 * - Sur une vraie analyse : `POST /assistant/questions`. La réponse ne vient
 *   que des passages de la base documentaire, chaque phrase cite sa source ;
 *   sans passage pertinent, l'assistant le dit au lieu d'inventer. Le serveur
 *   joint le contexte ANONYME de l'analyse (types, dents, confiances).
 *   Réservé à `assistant:use` : sans elle, le panneau le dit et reste muet.
 */
const SRC = {
  lpa: { t: "Lésions péri-apicales : signes radiologiques", o: "Base documentaire de démonstration · fiche 12", q: "…zone radio-claire centrée sur l'apex, de taille et de contours variables ; l'image seule ne permet pas d'en préciser la nature." },
  pano: { t: "Lire une radiographie panoramique", o: "Base documentaire de démonstration · chapitre 4", q: "…examen de première intention ; une image suspecte se confirme par un cliché complémentaire et l'examen clinique." },
  conf: { t: "Comprendre l'indice de confiance", o: "Documentation PanoraDent · section 3", q: "…le score exprime la certitude du modèle sur sa propre proposition, pas une probabilité clinique." },
  det36: { t: "Détections de l'analyse n° 0042", o: "Données de cette analyse", q: "Dent 36 : carie profonde, 91 %, validée ; lésion péri-apicale, 58 %, validée." },
  classes: { t: "Classes d'anomalies du jeu DENTEX", o: "Résumé de démonstration de la documentation du jeu de données", q: "…quatre classes : carie, carie profonde, lésion péri-apicale, dent incluse." },
  seuil: { t: "Régler le seuil de confiance", o: "Documentation PanoraDent · section 4", q: "…abaisser le seuil réduit les oublis mais augmente les fausses alertes." },
};

/** Réponses de démonstration : fragments de texte et renvois numérotés aux sources. */
const ANSWERS = {
  lpa: {
    parts: [
      "Une lésion péri-apicale est une modification de l'os autour de l'extrémité de la racine (l'apex). Sur une panoramique, elle apparaît le plus souvent comme une zone plus sombre, dite radio-claire, autour de l'apex",
      0,
      ". Elle accompagne souvent une atteinte de la pulpe, mais d'autres causes existent : l'examen clinique et, si besoin, un cliché complémentaire permettent de conclure",
      1,
      ".",
    ],
    src: ["lpa", "pano"],
  },
  d36: {
    parts: [
      "Sur la 36, le modèle a proposé deux détections",
      0,
      " : une carie profonde (confiance 91 %), zone radio-claire étendue de la couronne qui se rapproche de la chambre pulpaire, et une lésion péri-apicale (58 %) à l'extrémité de la racine mésiale. Vous avez validé les deux. L'indice de confiance mesure la certitude du modèle sur sa proposition ; ce n'est pas une probabilité clinique",
      1,
      ".",
    ],
    src: ["det36", "conf"],
  },
  diff: {
    parts: [
      "Dans le jeu DENTEX, la carie désigne une atteinte limitée (émail, dentine superficielle) et la carie profonde une atteinte qui s'étend vers la pulpe",
      0,
      ". La frontière entre les deux reste une appréciation : c'est pour cela que vous pouvez corriger le type, comme vous l'avez fait sur la 17.",
    ],
    src: ["classes"],
  },
  conf: {
    parts: [
      "Pour chaque cadre, le modèle donne un score de 0 à 100 % : sa certitude qu'une anomalie est présente et qu'elle appartient à cette classe",
      0,
      ". Seuls les cadres au-dessus du seuil réglé s'affichent (50 % ici). Baisser le seuil montre plus de propositions, au prix de fausses alertes plus nombreuses",
      1,
      ".",
    ],
    src: ["conf", "seuil"],
  },
  d46: {
    parts: [
      "Sur la 46, le modèle a proposé une lésion péri-apicale (confiance 78 %), non revue pour l'instant : une zone radio-claire autour de l'apex de la racine mésiale",
      0,
      ". Comparez avec l'aspect de la 36, où une image comparable a été validée.",
    ],
    src: ["lpa"],
  },
};

const REFUSALS = {
  diag: [
    "Je ne peux pas poser de diagnostic ni recommander un traitement : la décision clinique vous revient.",
    "Je peux en revanche vous expliquer ce que le modèle a détecté sur la dent concernée et ce que décrit la base documentaire. Par exemple : « Pourquoi la dent 46 est-elle signalée ? »",
  ],
  off: ["Je réponds uniquement aux questions sur cette analyse et sur la lecture des radiographies panoramiques.", "Essayez par exemple : « Comment est calculé l'indice de confiance ? »"],
  nosrc: [
    "Je n'ai pas trouvé de passage assez pertinent dans la base documentaire pour vous répondre en citant une source. Je préfère ne pas répondre sans source.",
    "Reformulez votre question, ou choisissez une suggestion ci-dessous.",
  ],
};

function route(q) {
  const s = q.toLowerCase();
  if (/diagnos|traitement|dévital|devital|extraire|extraction|faut-il|prescri|soigner|opérer/.test(s)) return { refusal: "diag" };
  if (/36/.test(s)) return { key: "d36" };
  if (/46/.test(s)) return { key: "d46" };
  if (/péri-apic|peri-apic|périapic|apex/.test(s)) return { key: "lpa" };
  if (/différence|difference|profonde/.test(s)) return { key: "diff" };
  if (/confiance|seuil|score|calcul/.test(s)) return { key: "conf" };
  if (/dent|carie|lésion|lesion|inclus|fdi|radio|pano|racine|détection|detection|modèle|modele|os\b/.test(s)) return { refusal: "nosrc" };
  return { refusal: "off" };
}

const DEMO_START = [
  { who: "user", text: "Que signifie une lésion péri-apicale ?" },
  { who: "bot", key: "lpa", fb: "up" },
  { who: "user", text: "Faut-il dévitaliser la 46 ?" },
  { who: "bot", refusal: "diag" },
];

function BotMessage({ m, index, onFeedback }) {
  const bodyRef = useRef(null);
  const flash = (i) => {
    const src = bodyRef.current?.querySelectorAll(".src")[i];
    if (!src) return;
    src.classList.add("flash");
    src.scrollIntoView({ block: "nearest" });
    setTimeout(() => src.classList.remove("flash"), 1200);
  };
  const answer = m.key ? ANSWERS[m.key] : null;
  return (
    <div className={`msg bot${m.refusal ? " refusal" : ""}`}>
      <span className="who">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/Icone.svg" alt="" style={{ width: 16, height: 16 }} />
        Assistant PanoraDent
      </span>
      <div className="body" ref={bodyRef}>
        {answer ? (
          <>
            <p>
              {answer.parts.map((part, i) =>
                typeof part === "number" ? (
                  <button key={i} type="button" className="cite" onClick={() => flash(part)}>
                    [{part + 1}]
                  </button>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </p>
            <div className="srcs">
              {answer.src.map((k, i) => (
                <div key={k} className="src">
                  <b>
                    [{i + 1}] {SRC[k].t}
                  </b>
                  <q>{SRC[k].q}</q>
                  <span className="origin">{SRC[k].o} (document fictif)</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          REFUSALS[m.refusal].map((p) => <p key={p}>{p}</p>)
        )}
        <p className="reminder">
          <Icon name="info" />
          Aide à la décision : cette explication ne constitue pas un diagnostic.
        </p>
        <div className="fb">
          <span>Cette réponse vous aide-t-elle ?</span>
          <button type="button" className="vbtn" aria-label="Utile" aria-pressed={m.fb === "up"} onClick={() => onFeedback(index, "up")}>
            <Icon name="thumbup" />
          </button>
          <button type="button" className="vbtn" aria-label="Pas utile" aria-pressed={m.fb === "down"} onClick={() => onFeedback(index, "down")}>
            <Icon name="thumbdown" />
          </button>
          {m.fb ? <span>{m.fb === "up" ? "Merci, retour enregistré." : "Merci : la réponse sera revue."}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Réponse du serveur : texte avec renvois, sources dépliables, avertissement. */
function RealBotMessage({ answer }) {
  const listRef = useRef(null);
  const open = (n) => {
    const src = listRef.current?.querySelector(`[data-source="${n}"]`);
    if (!src) return;
    src.open = true;
    src.classList.add("flash");
    src.scrollIntoView({ block: "nearest" });
    setTimeout(() => src.classList.remove("flash"), 1200);
  };
  const isAnswer = answer.status === AnswerStatus.ANSWER;
  return (
    <div className={`msg bot${isAnswer ? "" : " refusal"}`} data-testid="assistant-reponse">
      <span className="who">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/Icone.svg" alt="" style={{ width: 16, height: 16 }} />
        Assistant PanoraDent
      </span>
      <div className="body">
        {isAnswer ? (
          <>
            <p>
              {citationParts(answer.text, answer.sources).map((part, i) =>
                typeof part === "number" ? (
                  // eslint-disable-next-line react/no-array-index-key
                  <button key={i} type="button" className="cite" aria-label={`Source ${part}`} onClick={() => open(part)}>
                    [{part}]
                  </button>
                ) : (
                  // eslint-disable-next-line react/no-array-index-key
                  <span key={i}>{part}</span>
                ),
              )}
            </p>
            <div className="srcs" ref={listRef} aria-label="Sources citées">
              {answer.sources.map((src) => (
                <details key={src.number} className="src" data-source={src.number}>
                  <summary>
                    <b>
                      [{src.number}] {src.title}
                    </b>
                    <span className="origin">{sourceOrigin(src)}</span>
                  </summary>
                  <q>{src.excerpt}</q>
                  <a className="src-link" href={src.url} target="_blank" rel="noopener noreferrer">
                    Ouvrir le document{src.page ? ` à la page ${src.page}` : ""}
                  </a>
                </details>
              ))}
            </div>
          </>
        ) : (
          <p>{answer.text}</p>
        )}
        <p className="reminder">
          <Icon name="info" />
          {answer.warning || "Aide à la décision : cette explication ne constitue pas un diagnostic."}
        </p>
      </div>
    </div>
  );
}

export function AssistantPane({ vm, current, pendingQuestion, onQuestionHandled, canAsk = true }) {
  const demo = vm?.demo;
  const [msgs, setMsgs] = useState(() => (demo ? DEMO_START : []));
  const [status, setStatus] = useState("idle");
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState(null);
  const chatRef = useRef(null);
  const muted = !demo && !canAsk;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs, status]);

  const ask = async (q) => {
    const text = q.replace(/\s+/g, " ").trim();
    if (!text || status === "loading" || muted) return;
    if (demo) {
      setMsgs((m) => [...m, { who: "user", text }]);
      setStatus("loading");
      const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 200 : 1100;
      setTimeout(() => {
        setMsgs((m) => [...m, { who: "bot", ...route(text) }]);
        setStatus("idle");
      }, delay);
      return;
    }
    const invalid = validateQuestion(text);
    if (invalid) {
      setNotice(invalid);
      return;
    }
    setNotice(null);
    setMsgs((m) => [...m, { who: "user", text }]);
    setStatus("loading");
    try {
      const answer = await askAssistant({ question: text, analysisId: vm.id });
      setMsgs((m) => [...m, { who: "bot", real: answer }]);
      setStatus("idle");
    } catch (cause) {
      const error = toAppError(cause);
      // Refus du serveur (question invalide, droit retiré) : son message ; sinon, l'état « indisponible ».
      if (error.status && error.status < 500 && error.status !== 408) {
        setMsgs((m) => m.slice(0, -1));
        setNotice(error.message);
        setStatus("idle");
      } else {
        setStatus("error");
      }
    }
  };

  useEffect(() => {
    if (pendingQuestion) {
      ask(pendingQuestion);
      onQuestionHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

  const retry = () => {
    const lastUser = [...msgs].reverse().find((m) => m.who === "user");
    setStatus("idle");
    if (lastUser) {
      setMsgs((m) => m.filter((x) => x !== lastUser));
      setTimeout(() => ask(lastUser.text), 0);
    }
  };

  const suggestions = [
    "Que signifie une lésion péri-apicale ?",
    current ? `Pourquoi la dent ${current.fdi} est-elle signalée ?` : "Pourquoi la dent 36 est-elle signalée ?",
    "Quelle différence entre carie et carie profonde ?",
    "Comment est calculé l'indice de confiance ?",
  ];

  return (
    <>
      <div className="chat-ctx">
        <div className="chat-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/Icone.svg" alt="" />
          Assistant PanoraDent
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <span>
            Conversation liée à l&apos;<b>analyse n° {vm?.number}</b> · {msgs.filter((m) => m.who === "user").length} questions
          </span>
          <span>
            Détection sélectionnée :{" "}
            <b>{current ? `dent ${current.fdi}, ${detectionType(current.label).label.toLowerCase()} (${current.confidence == null ? "ajoutée" : pct(current.confidence)})` : "aucune"}</b>
          </span>
        </div>
      </div>
      <div className="chat" ref={chatRef} aria-live="polite">
        {msgs.map((m, i) =>
          m.who === "user" ? (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="msg user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : m.real ? (
            // eslint-disable-next-line react/no-array-index-key
            <RealBotMessage key={i} answer={m.real} />
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <BotMessage key={i} m={m} index={i} onFeedback={(idx, fb) => setMsgs((list) => list.map((x, k) => (k === idx ? { ...x, fb } : x)))} />
          ),
        )}
        {status === "loading" ? (
          <div className="msg bot">
            <span className="who">
              <Icon name="sparkle" />
              Assistant PanoraDent
            </span>
            <span className="typing">
              <i />
              <i />
              <i /> Recherche dans la base documentaire…
            </span>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="chat-err">
            <strong>L&apos;assistant est indisponible pour le moment.</strong>
            <span style={{ color: "var(--color-viewer-muted)" }}>Vos détections et votre relecture ne sont pas affectées.</span>
            <button type="button" className="vbtn outline" style={{ justifySelf: "start" }} onClick={retry}>
              <Icon name="refresh" />
              Réessayer
            </button>
          </div>
        ) : null}
      </div>
      {muted ? (
        <p className="chat-muted" role="note">
          L&apos;assistant documentaire n&apos;est pas ouvert à votre rôle. Demandez à l&apos;administrateur si vous en avez besoin.
        </p>
      ) : (
        <div className="sugg" aria-label="Suggestions de questions">
          {suggestions.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} disabled={status === "loading"}>
              {q}
            </button>
          ))}
        </div>
      )}
      {notice ? (
        <p className="chat-notice" role="alert">
          {notice}
        </p>
      ) : null}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (status === "loading") return;
          ask(input);
          setInput("");
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Votre question
        </label>
        <input
          className="vinput"
          id="ask"
          autoComplete="off"
          maxLength={1000}
          placeholder={muted ? "Assistant non disponible pour votre rôle" : "Posez une question sur cette analyse…"}
          value={input}
          disabled={muted}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="vbtn accent" aria-label="Envoyer" disabled={muted || status === "loading"}>
          <Icon name="send" />
        </button>
      </form>
      <p className="composer-note">
        L&apos;assistant explique à partir de la base documentaire, cite ses sources et ne pose jamais de diagnostic. Il ne
        reçoit que les détections retenues de cette analyse (type, dent, confiance) : ni l&apos;image, ni la référence, ni vos notes.
        {demo ? null : " La conversation n’est pas conservée : elle s’efface en quittant la page."}
      </p>
    </>
  );
}
