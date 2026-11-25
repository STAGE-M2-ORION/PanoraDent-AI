import { useEffect, useRef, useState } from "react";

import {
  AnswerStatus, citationParts, clipboardText, conclusionBlock, deleteConversation, fetchConversation, sourceOrigin,
  streamQuestion, validateQuestion,
} from "@/entities/assistant";
import { detectionType } from "@/entities/detection";
import { toAppError } from "@/shared/api";
import { Icon } from "@/shared/ui";

import { pct } from "@/widgets/analysis-workspace";

/**
 * Assistant documentaire (sprints 9 et 10).
 * - En démonstration : les réponses de la maquette, sources fictives, sans
 *   appel au serveur.
 * - Sur une vraie analyse : le fil du praticien est repris à l'ouverture ; la
 *   réponse s'écrit au fil de l'eau (brouillon), puis est remplacée par la
 *   réponse VÉRIFIÉE, ou retirée si elle ne cite pas ses sources. « Arrêter »
 *   coupe la connexion : le serveur cesse de rédiger. Une réponse se copie,
 *   ou s'insère dans la conclusion (marquée, modifiable). Le fil s'efface ;
 *   après clôture, il se lit mais ne se poursuit plus.
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

/** Réponse vérifiée : texte avec renvois, sources dépliables, actions, avertissement. */
function RealBotMessage({ answer, onCopy, onInsert }) {
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
    <div className={`msg bot${isAnswer ? "" : " refusal"}`} data-testid="assistant-reponse" data-statut={answer.status}>
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
            <div className="msg-actions">
              <button type="button" className="vbtn outline" onClick={() => onCopy(answer)}>
                <Icon name="copy" />
                Copier
              </button>
              {onInsert ? (
                <button type="button" className="vbtn outline" onClick={() => onInsert(answer)}>
                  <Icon name="edit" />
                  Insérer dans la conclusion
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p>{answer.text}</p>
        )}
        {answer.status === AnswerStatus.INTERRUPTED ? null : (
          <p className="reminder">
            <Icon name="info" />
            {answer.warning || "Aide à la décision : cette explication ne constitue pas un diagnostic."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Brouillon en cours de rédaction : affiché tel quel, vérifié à la fin. */
function DraftMessage({ text }) {
  return (
    <div className="msg bot draft" data-testid="assistant-brouillon" aria-busy="true">
      <span className="who">
        <Icon name="sparkle" />
        Assistant PanoraDent
      </span>
      <div className="body">
        {text ? (
          <p>{text}</p>
        ) : (
          <span className="typing">
            <i />
            <i />
            <i /> Recherche dans la base documentaire…
          </span>
        )}
        <p className="reminder">
          <Icon name="clock" />
          Rédaction en cours : les sources sont vérifiées à la fin. Une réponse qui ne les cite pas sera retirée.
        </p>
      </div>
    </div>
  );
}

const DEMO_SUGGESTIONS = (current) => [
  "Que signifie une lésion péri-apicale ?",
  current ? `Pourquoi la dent ${current.fdi} est-elle signalée ?` : "Pourquoi la dent 36 est-elle signalée ?",
  "Quelle différence entre carie et carie profonde ?",
  "Comment est calculé l'indice de confiance ?",
];

const INTERRUPTED = { status: AnswerStatus.INTERRUPTED, text: "Réponse interrompue à votre demande.", sources: [], warning: "" };

export function AssistantPane({ vm, current, pendingQuestion, onQuestionHandled, canAsk = true, closed = false, onInsertConclusion }) {
  const demo = vm?.demo;
  const muted = !demo && !canAsk;
  const [msgs, setMsgs] = useState(() => (demo ? DEMO_START : []));
  const [thread, setThread] = useState({ loading: !demo && canAsk, suggestions: [], readOnly: false, error: null });
  const [status, setStatus] = useState("idle"); // idle | loading (démonstration) | streaming | error
  const [draft, setDraft] = useState(null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState(null);
  const [flash, setFlash] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const chatRef = useRef(null);
  const abortRef = useRef(null);
  const lastQuestion = useRef(null);
  const analysisId = vm?.id;

  // Reprise du fil à l'ouverture ; une réponse en cours est arrêtée en quittant.
  useEffect(() => {
    if (demo || !canAsk || !analysisId) return undefined;
    let cancelled = false;
    fetchConversation(analysisId)
      .then((c) => {
        if (cancelled) return;
        setMsgs(c.messages);
        setThread({ loading: false, suggestions: c.suggestions, readOnly: c.readOnly, error: null });
      })
      .catch((cause) => {
        if (!cancelled) setThread((t) => ({ ...t, loading: false, error: toAppError(cause).message }));
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [demo, canAsk, analysisId]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs, status, draft]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  const busy = status === "loading" || status === "streaming";
  const readOnly = !demo && (thread.readOnly || closed);
  const locked = muted || readOnly || thread.loading;

  const ask = async (q) => {
    const text = q.replace(/\s+/g, " ").trim();
    if (!text || busy || locked) return;
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
    lastQuestion.current = text;
    setMsgs((m) => [...m, { who: "user", text, pending: true }]);
    setDraft("");
    setStatus("streaming");
    const controller = new AbortController();
    abortRef.current = controller;
    const withoutPending = (m) => m.filter((x) => !x.pending);
    try {
      const fin = await streamQuestion(analysisId, text, {
        signal: controller.signal,
        onFragment: (fragment) => setDraft((d) => (d ?? "") + fragment),
      });
      setMsgs((m) => [...withoutPending(m), fin.question, fin.answer]);
      setStatus("idle");
    } catch (cause) {
      if (cause?.name === "AbortError") {
        // Le serveur a gardé la question et une réponse « interrompue » : même chose à l'écran.
        setMsgs((m) => [...withoutPending(m), { who: "user", text }, { who: "bot", answer: INTERRUPTED }]);
        setStatus("idle");
      } else {
        const error = toAppError(cause);
        setMsgs(withoutPending);
        if (error.status && error.status < 500 && error.status !== 408) {
          setNotice(error.message);
          if (error.serverCode === "analyse_cloturee") setThread((t) => ({ ...t, readOnly: true }));
          setStatus("idle");
        } else {
          setStatus("error");
        }
      }
    } finally {
      setDraft(null);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (pendingQuestion) {
      ask(pendingQuestion);
      onQuestionHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

  const stop = () => abortRef.current?.abort();

  const retry = () => {
    setStatus("idle");
    if (lastQuestion.current) setTimeout(() => ask(lastQuestion.current), 0);
  };

  const copy = async (answer) => {
    try {
      await navigator.clipboard.writeText(clipboardText(answer));
      setFlash("Réponse copiée, avec ses sources.");
    } catch {
      setNotice("Copie impossible : le navigateur refuse l’accès au presse-papiers.");
    }
  };

  const insert = async (answer) => {
    try {
      await onInsertConclusion(conclusionBlock(answer));
      setFlash("Réponse insérée dans la conclusion, marquée « Assistant documentaire » : relisez-la et modifiez-la à votre guise.");
    } catch (cause) {
      setNotice(toAppError(cause).message);
    }
  };

  const clear = async () => {
    try {
      await deleteConversation(analysisId);
      setMsgs([]);
      setFlash("Conversation effacée.");
    } catch (cause) {
      setNotice(toAppError(cause).message);
    } finally {
      setConfirmClear(false);
    }
  };

  const suggestions = demo ? DEMO_SUGGESTIONS(current) : thread.suggestions;
  const questions = msgs.filter((m) => m.who === "user").length;

  return (
    <>
      <div className="chat-ctx">
        <div className="chat-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/Icone.svg" alt="" />
          Assistant PanoraDent
          {!demo && !locked && msgs.length && !busy ? (
            confirmClear ? (
              <span className="chat-clear">
                <button type="button" className="vbtn outline" onClick={clear}>
                  Confirmer l’effacement
                </button>
                <button type="button" className="vbtn" onClick={() => setConfirmClear(false)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button type="button" className="vbtn chat-clear" onClick={() => setConfirmClear(true)}>
                <Icon name="trash" />
                Effacer la conversation
              </button>
            )
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <span>
            Conversation liée à l&apos;<b>analyse n° {vm?.number}</b> · {questions} question{questions > 1 ? "s" : ""}
          </span>
          <span>
            Détection sélectionnée :{" "}
            <b>{current ? `dent ${current.fdi}, ${detectionType(current.label).label.toLowerCase()} (${current.confidence == null ? "ajoutée" : pct(current.confidence)})` : "aucune"}</b>
          </span>
        </div>
      </div>
      <div className="chat" ref={chatRef} aria-live="polite">
        {thread.loading ? <p className="chat-muted">Chargement de votre conversation…</p> : null}
        {msgs.map((m, i) =>
          m.who === "user" ? (
            <div key={m.id ?? `u${i}`} className="msg user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : m.answer ? (
            <RealBotMessage key={m.id ?? `r${i}`} answer={m.answer} onCopy={copy} onInsert={onInsertConclusion && !readOnly ? insert : null} />
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <BotMessage key={i} m={m} index={i} onFeedback={(idx, fb) => setMsgs((list) => list.map((x, k) => (k === idx ? { ...x, fb } : x)))} />
          ),
        )}
        {draft !== null ? <DraftMessage text={draft} /> : null}
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
      ) : readOnly ? (
        <p className="chat-muted" role="note">
          Analyse clôturée : la conversation se relit, mais ne se poursuit plus.
        </p>
      ) : (
        <div className="sugg" aria-label="Suggestions de questions">
          {suggestions.map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} disabled={busy || locked}>
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
      {thread.error ? (
        <p className="chat-notice" role="alert">
          {thread.error}
        </p>
      ) : null}
      {flash ? (
        <p className="chat-flash" role="status">
          {flash}
        </p>
      ) : null}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
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
          placeholder={muted ? "Assistant non disponible pour votre rôle" : readOnly ? "Conversation en lecture seule" : "Posez une question sur cette analyse…"}
          value={input}
          disabled={locked}
          onChange={(e) => setInput(e.target.value)}
        />
        {status === "streaming" ? (
          <button type="button" className="vbtn outline" onClick={stop}>
            <Icon name="square" />
            Arrêter
          </button>
        ) : (
          <button type="submit" className="vbtn accent" aria-label="Envoyer" disabled={locked || busy}>
            <Icon name="send" />
          </button>
        )}
      </form>
      <p className="composer-note">
        L&apos;assistant explique à partir de la base documentaire, cite ses sources et ne pose jamais de diagnostic. Il ne
        reçoit que les détections retenues de cette analyse (type, dent, confiance) : ni l&apos;image, ni la référence, ni vos notes.
        {demo ? null : " Votre conversation est conservée avec cette analyse ; vous seul la voyez."}
      </p>
    </>
  );
}
