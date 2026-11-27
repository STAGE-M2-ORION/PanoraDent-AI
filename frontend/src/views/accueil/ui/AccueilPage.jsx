import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ANOMALY_LABELS, DETECTION_TYPES, DetSwatch, DetectionBox, DetectionLabel, PANO_TEETH, panoBoxFor, SimulatedPanoImage } from "@/entities/detection";
import { RequestAccessModal } from "@/features/request-access";
import { demoDetections } from "@/shared/demo";
import { Alert, Button, Card, Icon, Logo, PhotoStack } from "@/shared/ui";

const TEETH_BOXES = Object.values(PANO_TEETH).map((t) => ({ fdi: t.fdi, box: t.box }));
const LIST_ORDER = [DetectionLabel.DEEP_CARIES, DetectionLabel.PERIAPICAL_LESION, DetectionLabel.IMPACTED_TOOTH, DetectionLabel.CARIES];

const PHOTOS = [
  { src: "/medias/connexion/01-cabinet.webp", caption: "L’examen au cabinet", alt: "Salle de soins dentaires lumineuse : fauteuil gris et blanc, scialytique et unit de soins, sans personne." },
  { src: "/medias/connexion/02-appareil-panoramique.webp", caption: "La radiographie panoramique", alt: "Appareil de radiographie panoramique fixé au mur d’une salle d’imagerie, à côté de son pupitre de commande." },
  { src: "/medias/connexion/03-radiographie-ecran.webp", caption: "L’analyse par le modèle", alt: "Radiographie panoramique dentaire affichée en gros plan sur un écran d’ordinateur." },
  { src: "/medias/connexion/04-praticien-ecran.webp", caption: "La validation par le praticien", alt: "Praticienne assise devant un écran qui affiche une radiographie panoramique, la main sur la souris." },
  { src: "/medias/connexion/05-consultation.webp", caption: "Le compte rendu", alt: "Praticien masqué en blouse grise, debout près d’un patient vu de dos, dans une salle de soins." },
].map((p) => ({ ...p, width: 1200, height: 1600 }));

const DET_DEF = {
  [DetectionLabel.TOOTH]: ["Numérotation FDI", "Un numéro à deux chiffres par dent, de 11 à 48."],
  [DetectionLabel.CARIES]: ["Carie", "Zone sombre (radio-claire) limitée à l'émail ou à la dentine."],
  [DetectionLabel.DEEP_CARIES]: ["Carie profonde", "Zone sombre qui atteint la chambre pulpaire."],
  [DetectionLabel.PERIAPICAL_LESION]: ["Lésion péri-apicale", "Zone sombre (radio-claire) autour de l'apex de la racine."],
  [DetectionLabel.IMPACTED_TOOTH]: ["Dent incluse", "Dent restée dans l'os, souvent une dent de sagesse."],
};

/** Petit schéma de chaque type : une dent stylisée et le cadre de la classe. */
function DetShape({ label }) {
  const tooth = (
    <>
      <path d="M68 14h24q4 0 4 5v13H64V19q0-5 4-5z" fill="#9aa4ab" />
      <path d="M66 32h12l-3 26h-6zM82 32h12l-3 26h-6z" fill="#6d767d" />
    </>
  );
  const frames = {
    [DetectionLabel.TOOTH]: (
      <>
        <rect x="62" y="12" width="36" height="46" rx="5" fill="none" stroke="#56B4E9" strokeWidth="2" />
        <text x="80" y="9" fill="#56B4E9" fontSize="9" fontFamily="JetBrains Mono" textAnchor="middle">
          36
        </text>
      </>
    ),
    [DetectionLabel.CARIES]: <rect x="70" y="18" width="20" height="12" rx="3" fill="#F0E44222" stroke="#F0E442" strokeWidth="2" />,
    [DetectionLabel.DEEP_CARIES]: <rect x="66" y="14" width="28" height="24" rx="3" fill="#D55E0022" stroke="#D55E00" strokeWidth="2" />,
    [DetectionLabel.PERIAPICAL_LESION]: <rect x="68" y="40" width="24" height="24" rx="3" fill="#CC79A722" stroke="#CC79A7" strokeWidth="2" />,
    [DetectionLabel.IMPACTED_TOOTH]: <rect x="58" y="10" width="44" height="52" rx="5" fill="#009E7322" stroke="#009E73" strokeWidth="2" />,
  };
  return (
    <svg viewBox="0 0 160 70" aria-hidden="true">
      {label === DetectionLabel.IMPACTED_TOOTH ? <g transform="rotate(-35 80 36)">{tooth}</g> : tooth}
      {frames[label]}
    </svg>
  );
}

/** Aperçu de la visionneuse : le seuil de confiance filtre l'affichage en direct. */
function HeroViewer() {
  const [threshold, setThreshold] = useState(50);
  const visible = demoDetections.filter((d) => d.confidence == null || d.confidence >= threshold);
  return (
    <div>
      <figure className="mini" style={{ margin: 0 }} aria-label="Aperçu de la visionneuse avec détections (image simulée)">
        <div className="mini-bar">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <b>Analyse n° 0042</b>
          <span className="mono">ID anonyme 7F3A</span>
          <span style={{ marginLeft: "auto", color: "var(--color-viewer-muted)" }}>6 sur 9 relues</span>
        </div>
        <div className="mini-body">
          <div className="mini-img">
            <svg viewBox="0 0 1200 600" aria-hidden="true">
              <SimulatedPanoImage watermark />
            </svg>
            <svg className="ovl" viewBox="0 0 1200 600" aria-hidden="true">
              {TEETH_BOXES.map(({ fdi, box }) => (
                <rect key={fdi} x={box.x} y={box.y} width={box.w} height={box.h} rx="6" fill="none" stroke="#56B4E9" strokeWidth="1.2" opacity=".4" />
              ))}
              {visible.map((d) => (
                <DetectionBox
                  key={d.id}
                  box={panoBoxFor(d.fdi, d.label)}
                  label={d.label}
                  fdi={d.fdi}
                  confidence={d.confidence}
                  dashed={d.source === "user" || d.status === "corrected"}
                />
              ))}
            </svg>
          </div>
          <div className="mini-side">
            <h3>Détections au-dessus du seuil</h3>
            {LIST_ORDER.map((label) => {
              const n = visible.filter((d) => d.label === label).length;
              return (
                <div key={label} className={n ? "mrow" : "mrow off"}>
                  <span className="sw" style={{ background: DETECTION_TYPES[label].color }} />
                  {DETECTION_TYPES[label].label}
                  <span className="n">{n}</span>
                </div>
              );
            })}
            <div className="mrow">
              <span className="sw" style={{ background: "#56B4E9" }} />
              Dents numérotées<span className="n">31</span>
            </div>
          </div>
        </div>
        <div className="mini-thr">
          <label htmlFor="heroThr">Seuil de confiance</label>
          <input type="range" id="heroThr" min="0" max="100" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <output htmlFor="heroThr">{threshold}&nbsp;%</output>
        </div>
      </figure>
      <p className="fict">
        <Icon name="info" />
        Image simulée et données fictives. Faites glisser le seuil : l&apos;affichage suit.
      </p>
    </div>
  );
}

/** Apparition au défilement (coupée en mouvement réduit, cf. CSS). */
function useReveal(rootRef) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    setArmed(true);
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    const nodes = root.querySelectorAll(".reveal");
    nodes.forEach((el) => io.observe(el));
    const fallback = setTimeout(() => nodes.forEach((el) => el.classList.add("in")), 2500);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, [rootRef]);
  return armed;
}

/** Vitrine publique : comprendre l'outil avant d'y déposer une image. */
/**
 * Mesures publiées de la version `dentex-2026.11` (rapport
 * docs/evaluation/dentex-2026.11/rapport.md, test interne évalué une fois).
 * À mettre à jour avec chaque version publiée.
 */
const MESURES_TEST_INTERNE = {
  [DetectionLabel.TOOTH]: "0,99",
  [DetectionLabel.IMPACTED_TOOTH]: "0,93",
  [DetectionLabel.CARIES]: "0,49",
  [DetectionLabel.DEEP_CARIES]: "0,37",
  [DetectionLabel.PERIAPICAL_LESION]: "0,25",
};

export function AccueilPage() {
  const rootRef = useRef(null);
  const armed = useReveal(rootRef);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const openAccess = () => setAccessOpen(true);

  return (
    <div ref={rootRef} className={armed ? "v-accueil js" : "v-accueil"}>
      <Head>
        <title>PanoraDent AI · Une seconde lecture pour vos panoramiques</title>
        <meta
          name="description"
          content="Plateforme d'aide à la lecture des radiographies panoramiques : numérotation FDI, quatre anomalies proposées, relecture par le praticien, compte rendu anonymisé. Prototype académique non certifié."
        />
      </Head>
      <div className="legal-top" role="note">
        <strong>Prototype académique non certifié</strong> · aide à la décision, ne remplace pas le jugement du praticien
      </div>
      <header className="site-head">
        <div className="container" style={{ position: "relative" }}>
          <Logo href="/decouvrir" />
          <nav className="site-nav" id="siteNav" aria-label="Navigation principale" data-open={menuOpen ? "true" : "false"} onClick={(e) => e.target.closest("a") && setMenuOpen(false)}>
            <a href="#fonctionnement">Fonctionnement</a>
            <a href="#fiabilite">Fiabilité</a>
            <a href="#securite">Sécurité</a>
          </nav>
          <div className="head-cta">
            <Button variant="secondary" size="sm" onClick={openAccess}>
              Demander un accès
            </Button>
            <Button size="sm" href="/connexion">
              Se connecter
            </Button>
          </div>
          <button className="btn btn-ghost btn-sm burger" type="button" aria-label="Ouvrir le menu" aria-expanded={menuOpen} aria-controls="siteNav" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name="menu" />
          </button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <p className="eyebrow">Aide à la lecture des radiographies panoramiques</p>
              <h1>
                Une seconde lecture pour vos <em>radiographies panoramiques</em>
              </h1>
              <p className="lead">Déposez la panoramique : les dents sont numérotées et quatre anomalies vous sont signalées. Vous relisez, vous décidez, puis vous générez le compte rendu.</p>
              <div className="hero-actions">
                <Button href="/connexion">Se connecter</Button>
                <Button variant="secondary" onClick={openAccess}>
                  Demander un accès
                </Button>
              </div>
              <div className="hero-facts">
                <span>
                  <Icon name="check" />
                  Le praticien valide chaque détection
                </span>
                <span>
                  <Icon name="check" />
                  Image anonymisée, jamais envoyée à l&apos;extérieur
                </span>
                <span>
                  <Icon name="check" />
                  Gratuit, sans abonnement
                </span>
              </div>
            </div>
            <HeroViewer />
          </div>
        </section>

        {/* Le parcours en 5 photos : la pile en éventail */}
        <section className="sec-pile" aria-labelledby="cab-h">
          <div className="container">
            <div className="pile-grid">
              <div className="cab-text">
                <p className="eyebrow">Le parcours, du cabinet au compte rendu</p>
                <h2 className="h2" id="cab-h">
                  Dans votre navigateur, là où vous lisez déjà
                </h2>
                <p className="lead">Rien à installer : la relecture s&apos;ouvre sur l&apos;ordinateur du cabinet, à côté de vos examens. Cinq étapes, du fauteuil au compte rendu.</p>
              </div>
              <PhotoStack photos={PHOTOS} label="Le parcours en 5 photos. Flèches gauche et droite pour changer de photo." />
            </div>
          </div>
        </section>

        {/* Fonctionnement */}
        <section className="sec band" id="fonctionnement">
          <div className="container">
            <p className="eyebrow">Fonctionnement</p>
            <div className="flow-head">
              <div>
                <h2 className="h2">De la panoramique au compte rendu en quatre gestes</h2>
                <p className="lead">Nous préparons la lecture ; la décision reste la vôtre.</p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="illus reveal" src="/medias/parcours-4-etapes.webp" width="1344" height="768" alt="Illustration : image importée, analyse, liste vérifiée, compte rendu, reliés dans l'ordre" loading="lazy" />
            </div>
            <div className="steps">
              {[
                ["upload", "01", "Importer", "Déposez la panoramique en DICOM, JPG ou PNG. Les données identifiantes sont retirées dès l'import."],
                ["cpu", "02", "Analyser", "Le modèle numérote les dents selon la norme FDI et propose les anomalies, chacune avec un indice de confiance."],
                ["edit", "03", "Relire et corriger", "Validez, corrigez, ajoutez ou supprimez chaque détection. Rien n'est retenu sans votre relecture."],
                ["file", "04", "Générer le compte rendu", "Un PDF anonymisé : image annotée, tableau des détections retenues, version du modèle."],
              ].map(([icon, num, title, text]) => (
                <div key={num} className="step card reveal">
                  <span className="ico">
                    <Icon name={icon} />
                  </span>
                  <span className="num">{num}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Ce que détecte la plateforme */}
        <section className="sec">
          <div className="container">
            <p className="eyebrow">Ce que détecte la plateforme</p>
            <h2 className="h2">La numérotation des dents et quatre anomalies, rien de plus</h2>
            <p className="lead">Chaque type a sa couleur, toujours accompagnée de son nom : la couleur seule ne suffit jamais.</p>
            <div className="det-grid">
              {Object.keys(DET_DEF).map((label) => (
                <div key={label} className={`card det-card reveal ${DETECTION_TYPES[label].cls}`}>
                  <div className="shape">
                    <DetShape label={label} />
                  </div>
                  <h3>
                    <DetSwatch label={label} filled />
                    {DET_DEF[label][0]}
                  </h3>
                  <p>{DET_DEF[label][1]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Vous gardez la main */}
        <section className="sec band">
          <div className="container split">
            <div>
              <p className="eyebrow">Vous gardez la main</p>
              <h2 className="h2">Rien n&apos;est retenu sans votre relecture</h2>
              <p className="lead">Chaque détection reste « non revue » jusqu&apos;à votre décision. Trait plein : proposition du modèle ; pointillé : votre ajout ou votre correction.</p>
              <div className="acts">
                {[
                  ["check", "Valider", "La proposition est retenue."],
                  ["edit", "Corriger", "Cadre, type ou numéro de dent."],
                  ["plus", "Ajouter", "Ce que le modèle a manqué."],
                  ["trash", "Supprimer", "Une fausse alerte, tracée."],
                ].map(([icon, title, text]) => (
                  <div key={title} className="act card">
                    <Icon name={icon} />
                    <div>
                      <b>{title}</b>
                      <span>{text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="review-demo reveal" aria-label="Exemple de relecture (données fictives)">
              {[
                ["#D55E00", false, "Dent 36 · Carie profonde", "91 %", "ok", "Validée"],
                ["#F0E442", true, "Dent 17 · Carie", "72 %", "cor", "Corrigée"],
                ["#F0E442", true, "Dent 45 · Carie", "—", "add", "Ajoutée"],
                ["#CC79A7", false, "Dent 46 · Lésion péri-apicale", "78 %", "wait", "Non revue"],
              ].map(([color, dashed, text, conf, st, stLabel]) => (
                <div key={text} className="rd-row">
                  <span className="sw" style={{ borderColor: color, borderStyle: dashed ? "dashed" : undefined }} />
                  <span>
                    {text}{" "}
                    <span className="mono" style={{ color: "var(--color-viewer-muted)" }}>
                      {conf}
                    </span>
                  </span>
                  <span className={`st ${st}`}>{stLabel}</span>
                </div>
              ))}
              <div className="rd-foot">
                <span>Seuil de confiance réglable</span>
                <span>Clôture verrouillée, réouverture motivée</span>
              </div>
            </div>
          </div>
        </section>

        {/* Assistant */}
        <section className="sec">
          <div className="container split">
            <div className="card chat-demo reveal" aria-label="Exemple d'échange avec l'assistant (sources fictives)">
              <div className="q">Pourquoi la dent 36 est-elle signalée ?</div>
              <div className="a">
                <span className="who">
                  <Icon name="sparkle" />
                  Assistant PanoraDent
                </span>
                <p>
                  Le modèle a proposé une carie profonde (91&nbsp;%) : une zone radio-claire étendue de la couronne, proche de la chambre pulpaire<sup>[1]</sup>. L&apos;indice de confiance mesure la certitude du
                  modèle, pas une probabilité clinique<sup>[2]</sup>.
                </p>
                <div className="srcs">
                  <div className="src">
                    <b>[1] Détections de l&apos;analyse n° 0042</b>
                    <q>Dent 36 : carie profonde, 91&nbsp;%, validée.</q>
                  </div>
                  <div className="src">
                    <b>[2] Comprendre l&apos;indice de confiance</b>
                    <q>…le score exprime la certitude du modèle sur sa propre proposition.</q>
                  </div>
                </div>
              </div>
              <div className="q">Faut-il dévitaliser la 46 ?</div>
              <div className="a">
                <span className="who">
                  <Icon name="sparkle" />
                  Assistant PanoraDent
                </span>
                <p className="refuse">Je ne peux pas poser de diagnostic ni recommander un traitement : la décision clinique vous revient. Je peux vous expliquer ce que le modèle a détecté sur la 46.</p>
                <p className="rem">
                  <Icon name="info" />
                  Aide à la décision : jamais un diagnostic. Sources de démonstration.
                </p>
              </div>
            </div>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="illus"
                src="/medias/assistant-sources.webp"
                width="1232"
                height="896"
                alt="Illustration : une bulle de dialogue reliée à des documents marqués d'un signet"
                loading="lazy"
                style={{ maxWidth: 260, margin: "0 0 var(--space-4) -24px" }}
              />
              <p className="eyebrow">Un assistant qui explique</p>
              <h2 className="h2">Chaque réponse cite ses sources</h2>
              <p className="lead">Interrogez l&apos;assistant sur l&apos;analyse en cours : il répond à partir de la base documentaire et montre le passage utilisé.</p>
            </div>
          </div>
        </section>

        {/* Sécurité */}
        <section className="sec dark-band" id="securite">
          <div className="container">
            <div className="sec-head">
              <div>
                <p className="eyebrow">Vos données protégées</p>
                <h2 className="h2">L&apos;image ne quitte pas le serveur</h2>
                <p className="lead">Nous analysons la radiographie sur le serveur de la plateforme : aucune image n&apos;est confiée à un service extérieur.</p>
              </div>
              <div className="illus-card reveal">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="illus" src="/medias/securite-serveur-local.webp" width="1232" height="896" alt="Illustration : serveur local relié à l'écran du cabinet, bouclier et cadenas, nuage barré" loading="lazy" />
              </div>
            </div>
            <div className="prot">
              {[
                ["eyeoff", "Anonymisation à l'import", "Balises DICOM, métadonnées et texte incrusté retirés avant l'analyse."],
                ["server", "Aucun envoi extérieur", "Le modèle et l'assistant tournent sur notre serveur."],
                ["key", "Droits par rôle", "Administrateur, praticien, lecteur. Pas d'inscription libre."],
                ["list", "Journal d'audit", "Connexions et actions sensibles, en ajout seul."],
              ].map(([icon, title, text]) => (
                <div key={title} className="reveal">
                  <Icon name={icon} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <div className="flow" aria-label="Parcours de l'image">
              {["Radiographie", "Anonymisation", "Analyse locale", "Relecture", "Compte rendu sans identité"].map((step, i) => (
                <span key={step} style={{ display: "contents" }}>
                  {i ? <Icon name="chevron" /> : null}
                  <span className="box">{step}</span>
                </span>
              ))}
              <span className="box x" style={{ marginLeft: "var(--space-4)" }}>
                Service externe
              </span>
            </div>
          </div>
        </section>

        {/* Fiabilité */}
        <section className="sec" id="fiabilite">
          <div className="container split" style={{ alignItems: "start" }}>
            <div>
              <p className="eyebrow">Fiabilité et limites</p>
              <h2 className="h2">Mesuré, et publié avec ses limites</h2>
              <p className="lead">
                Le modèle est entraîné sur DENTEX, un jeu public de panoramiques, et mesuré classe par classe sur des images jamais vues à l&apos;entraînement :
                le test interne, évalué une seule fois, puis le test officiel du jeu.
              </p>
              <ul className="limits">
                {[
                  "Caries et lésions péri-apicales encore mal retrouvées : environ 4 caries sur 10 et 3 lésions sur 10 au test interne. Le praticien relit chaque cliché.",
                  "Mesuré sur DENTEX seulement : pas encore sur des images de cabinets de Toliara.",
                  "Quatre anomalies seulement : ni parodonte, ni fractures, ni kystes.",
                  "Sensible à la qualité de l'image : flou, positionnement, artefacts métalliques.",
                ].map((text) => (
                  <li key={text}>
                    <Icon name="alert" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" href="/performance" style={{ marginTop: "var(--space-8)" }}>
                Voir la page Performance du modèle
              </Button>
            </div>
            <div className="card measure reveal">
              <h3>Précision moyenne (mAP@50), test interne</h3>
              <ul className="measure-cls">
                {[DetectionLabel.TOOTH, ...ANOMALY_LABELS].map((label) => (
                  <li key={label}>
                    <DetSwatch label={label} />
                    {label === DetectionLabel.TOOTH ? "Détection des dents" : DETECTION_TYPES[label].label}
                    <span className="mono" style={{ marginLeft: "auto" }}>
                      {MESURES_TEST_INTERNE[label]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                Version <span className="mono">dentex-2026.11</span> · de 0 (rien de juste) à 1 (tout juste). Détail, matrices et pires erreurs : page Performance du
                modèle.
              </p>
              <dl className="measure-def">
                <div>
                  <dt>Précision moyenne (mAP@50)</dt>
                  <dd>À quel point les cadres proposés tombent juste.</dd>
                </div>
                <div>
                  <dt>Rappel</dt>
                  <dd>La part des anomalies réelles que le modèle retrouve.</dd>
                </div>
                <div>
                  <dt>Précision</dt>
                  <dd>La part des propositions justes : l&apos;inverse des fausses alertes.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Appel final */}
        <section className="sec-tight">
          <div className="container">
            <Card className="cta">
              <div>
                <h2>Demandez un accès pour votre cabinet</h2>
                <p>Nous transmettons votre demande à l&apos;administrateur, qui crée le compte.</p>
              </div>
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <Button onClick={openAccess}>Demander un accès</Button>
                <Button variant="secondary" href="/connexion">
                  Se connecter
                </Button>
              </div>
            </Card>
            <Alert tone="warning" className="legal-band" role="note" title="Prototype non certifié, aide à la décision">
              PanoraDent AI ne remplace pas le jugement du praticien et ne pose aucun diagnostic. Ce n&apos;est pas un dispositif médical certifié.
            </Alert>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <div className="foot-grid">
            <div>
              <Logo href="/decouvrir" />
              <p className="muted" style={{ marginTop: "var(--space-3)", maxWidth: "42ch" }}>
                Prototype académique réalisé dans le cadre d&apos;un mémoire, à Toliara (Madagascar). Gratuit, non commercialisé.
              </p>
            </div>
            <div>
              <h3>Plateforme</h3>
              <ul>
                <li>
                  <a href="#fonctionnement">Fonctionnement</a>
                </li>
                <li>
                  <a href="#fiabilite">Fiabilité</a>
                </li>
                <li>
                  <a href="#securite">Sécurité</a>
                </li>
                <li>
                  <Link href="/connexion">Se connecter</Link>
                </li>
              </ul>
            </div>
            <div>
              <h3>Informations</h3>
              <ul>
                <li>
                  <Link href="/mentions">Mentions légales</Link>
                </li>
                <li>
                  <Link href="/mentions#donnees">Données personnelles</Link>
                </li>
                <li>
                  <a href="#contact" onClick={(e) => (e.preventDefault(), openAccess())}>
                    Contact
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3>École</h3>
              <ul>
                <li>
                  <span className="muted">Mémoire de fin d&apos;études, 2026</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 PanoraDent AI</span>
            <span>Jeu de données : DENTEX (public) · Aucune donnée de patient sur ce site</span>
          </div>
        </div>
      </footer>

      <RequestAccessModal open={accessOpen} onClose={() => setAccessOpen(false)} />
    </div>
  );
}
