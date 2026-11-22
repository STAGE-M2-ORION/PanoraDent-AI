import Head from "next/head";
import { useRef, useState } from "react";

import { DETECTION_TYPES, DetSwatch, DetectionBox, PANO_TEETH, SimulatedPanoImage, TypeChip, panoBoxFor } from "@/entities/detection";
import { demoDetections } from "@/shared/demo";
import { useAppTheme } from "@/shared/lib";
import {
  Alert,
  Badge,
  BarChart,
  Button,
  Card,
  DateCell,
  Field,
  Gauge,
  ICON_NAMES,
  Icon,
  IconAction,
  IdChip,
  Input,
  KpiRing,
  LineChart,
  Logo,
  Modal,
  NumChip,
  Pager,
  Person,
  ProgressList,
  Select,
  Skeleton,
  Textarea,
  VizEmpty,
  WhoChip,
  lastMonths,
  useToast,
} from "@/shared/ui";

const COLORS = [
  ["primary", "Action principale, liens"],
  ["primary-hover", "Survol"],
  ["primary-soft", "Fonds d'accent"],
  ["ink", "Texte, barre latérale marine"],
  ["bg", "Fond de page"],
  ["surface", "Cartes"],
  ["subtle", "Fonds secondaires"],
  ["border", "Liserés"],
  ["border-strong", "Liserés appuyés"],
  ["muted", "Texte secondaire"],
  ["success", "Succès"],
  ["warning", "Avertissement"],
  ["danger", "Erreur, suppression"],
  ["info", "Information"],
  ["viewer-bg", "Visionneuse"],
  ["viewer-accent", "Accent cyan (signature)"],
];

const ICON_SETS = [
  ["Propres à PanoraDent", "Dessinées pour le projet", ["tooth", "pano", "detect", "file", "sparkle"]],
  ["Navigation et comptes", "Duotone", ["home", "upload", "history", "chart", "users", "user", "key", "list", "activity", "shield", "bell", "eye"]],
  ["Données et système", "Duotone", ["database", "server", "cpu", "box", "mail", "message", "clock", "search", "download", "printer", "edit", "trash"]],
  ["États", "Duotone, l’accent suit la couleur du message", ["alert", "info", "lock", "unlock"]],
];
const LISTED = new Set(ICON_SETS.flatMap((s) => s[2]));
ICON_SETS.push(["Interface", "Trait simple", ICON_NAMES.filter((n) => !LISTED.has(n))]);

const MONTHS = lastMonths(12);
const SECTIONS = [
  ["fondations", "Fondations"],
  ["icones", "Icônes"],
  ["composants", "Composants"],
  ["donnees", "Données"],
  ["detections", "Détections"],
  ["etats", "États communs"],
];

function Section({ id, title, lead, children }) {
  return (
    <section className="ds-sec" id={id} aria-labelledby={`h-${id}`}>
      <header>
        <h2 id={`h-${id}`}>{title}</h2>
        {lead ? <p>{lead}</p> : null}
      </header>
      {children}
    </section>
  );
}

function IconCells({ names }) {
  return (
    <div className="sheet-grid">
      {names.map((n) => (
        <div key={n} className="sheet-cell">
          <Icon name={n} />
          <code>{n}</code>
        </div>
      ))}
    </div>
  );
}

/**
 * Catalogue vivant du design system : rend les vrais composants de
 * `shared/ui` et `entities/detection`, il ne peut donc pas mentir sur leur
 * apparence. Reprend la planche d'icônes et la page « États communs » de la maquette.
 */
export function DesignSystemPage() {
  const { theme, toggle } = useAppTheme("clair");
  const toast = useToast();
  const exportRef = useRef(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [page, setPage] = useState(1);

  return (
    <div className="v-design-system">
      <Head>
        <title>Design system · PanoraDent AI</title>
      </Head>
      <header className="ds-head">
        <div className="container">
          <Logo href="/" />
          <nav className="ds-nav" aria-label="Sections du design system">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <span style={{ marginLeft: "auto" }}>
            <button type="button" className="btn btn-ghost btn-sm theme-toggle" onClick={toggle} aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}>
              <Icon name={theme === "dark" ? "sun" : "contrast"} />
            </button>
          </span>
        </div>
      </header>

      <main className="container ds-body">
        <div className="page-head">
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)" }}>Design system PanoraDent</h2>
            <p>Jetons, icônes, composants et états, tirés de la maquette validée. Styles : `src/shared/ui/styles/` · composants : `src/shared/ui/`.</p>
          </div>
        </div>

        <Section id="fondations" title="Fondations" lead="Toutes les valeurs passent par des jetons CSS (`tokens.css`) : aucune valeur isolée dans les écrans. Le mode sombre redéfinit les mêmes jetons.">
          <div className="swatches">
            {COLORS.map(([token, use]) => (
              <div key={token} className="swatch">
                <i style={{ background: `var(--color-${token})` }} />
                <div>
                  <strong>{use}</strong>
                  <code>--color-{token}</code>
                </div>
              </div>
            ))}
          </div>
          <div className="grid-2">
            <Card pad className="type-scale">
              {[
                ["display", "Panora Display", { fontFamily: "var(--font-display)", fontSize: "var(--text-display)" }],
                ["3xl", "Titre de page", { fontSize: "var(--text-3xl)", fontWeight: 700 }],
                ["2xl", "Titre de section", { fontSize: "var(--text-2xl)", fontWeight: 700 }],
                ["lg", "Sous-titre", { fontSize: "var(--text-lg)", fontWeight: 600 }],
                ["base", "Texte courant Satoshi", { fontSize: "var(--text-base)" }],
                ["sm", "Interface dense", { fontSize: "var(--text-sm)" }],
                ["mono", "ID 7F3A · v0.3.1", { fontFamily: "var(--font-mono)" }],
              ].map(([token, text, style]) => (
                <div key={token}>
                  <code>--text-{token}</code>
                  <span style={style}>{text}</span>
                </div>
              ))}
            </Card>
            <Card pad className="space-scale">
              {[1, 2, 3, 4, 6, 8, 12, 16, 24].map((n) => (
                <div key={n}>
                  <code className="mono" style={{ width: 80 }}>
                    --space-{n}
                  </code>
                  <span className="bar" style={{ width: `var(--space-${n})` }} />
                </div>
              ))}
              <div className="row-wrap" style={{ marginTop: "var(--space-4)" }}>
                <span className="frame-corners" style={{ padding: "var(--space-4)", display: "inline-block" }}>
                  Motif signature : équerres cyan
                </span>
              </div>
            </Card>
          </div>
        </Section>

        <Section id="icones" title="Icônes" lead="Même grille (24 px), même trait (1,8), extrémités arrondies. Duotone : un aplat discret et un détail d’accent (teal sur fond clair, cyan sur fond sombre).">
          {ICON_SETS.map(([title, tag, names]) => (
            <section key={title}>
              <div className="dash-sec-h" style={{ marginBottom: "var(--space-3)" }}>
                <h3>{title}</h3>
                <span className="sheet-tag">{tag}</span>
              </div>
              <IconCells names={names} />
              <div className="sheet-dark" style={{ marginTop: "var(--space-3)" }}>
                <IconCells names={names} />
              </div>
            </section>
          ))}
        </Section>

        <Section id="composants" title="Composants" lead="Boutons (le principal et le secondaire portent l’effet « lumière »), champs, pastilles, alertes, modale et notification.">
          <div className="grid-2">
            <Card pad style={{ display: "grid", gap: "var(--space-4)" }}>
              <h3>Boutons</h3>
              <div className="row-wrap">
                <Button>
                  <Icon name="plus" />
                  Principal
                </Button>
                <Button variant="secondary">Secondaire</Button>
                <Button variant="ghost">Discret</Button>
                <Button variant="danger">
                  <Icon name="trash" />
                  Danger
                </Button>
              </div>
              <div className="row-wrap">
                <Button size="sm">Petit</Button>
                <Button size="sm" variant="secondary">
                  Petit secondaire
                </Button>
                <Button disabled>Désactivé</Button>
              </div>
              <div className="row-wrap">
                <IconAction icon="edit" label="Modifier" />
                <IconAction icon="file" label="Compte rendu" />
                <IconAction icon="trash" label="Supprimer" danger />
                <IconAction icon="lock" label="Indisponible" disabled />
              </div>
            </Card>
            <Card pad style={{ display: "grid", gap: "var(--space-4)" }}>
              <h3>Champs</h3>
              <Field label="Adresse e-mail" htmlFor="ds-mail" hint="Identifiant de connexion.">
                <Input id="ds-mail" type="email" placeholder="nom@cabinet.mg" />
              </Field>
              <Field label="Rôle" htmlFor="ds-role">
                <Select id="ds-role" defaultValue="Praticien">
                  <option>Administrateur</option>
                  <option>Praticien</option>
                  <option>Lecteur</option>
                </Select>
              </Field>
              <Field label="Avec erreur" htmlFor="ds-err" error="Cette adresse est déjà utilisée par un compte.">
                <Input id="ds-err" invalid defaultValue="rakoto@demo.panoradent.test" />
              </Field>
              <Field label="Commentaire" htmlFor="ds-com">
                <Textarea id="ds-com" placeholder="Observation du praticien" />
              </Field>
            </Card>
            <Card pad style={{ display: "grid", gap: "var(--space-4)" }}>
              <h3>Pastilles</h3>
              <div className="row-wrap">
                <Badge>Neutre</Badge>
                <Badge tone="success" dot>
                  Clôturée
                </Badge>
                <Badge tone="warning" dot>
                  À relire
                </Badge>
                <Badge tone="danger" dot>
                  Échec
                </Badge>
                <Badge tone="info" dot>
                  Relecture en cours
                </Badge>
                <Badge tone="primary">Personnalisé</Badge>
              </div>
              <div className="row-wrap">
                <IdChip>7F3A</IdChip>
                <NumChip>0042</NumChip>
                <WhoChip name="Dr Rakoto" />
                <DateCell date="16/11/2026" time="09:14" />
              </div>
              <Person name="Dr Rakoto" sub="rakoto@demo.panoradent.test" />
            </Card>
            <Card pad style={{ display: "grid", gap: "var(--space-3)" }}>
              <h3>Alertes</h3>
              <Alert tone="success" title="Analyse clôturée">
                Le compte rendu peut être généré.
              </Alert>
              <Alert tone="warning" title="Image à vérifier">
                Proportions inhabituelles pour une panoramique.
              </Alert>
              <Alert tone="danger" title="Fichier refusé">
                Le fichier dépasse 20 Mo.
              </Alert>
              <Alert tone="info">Aucune donnée identifiante : seul l’identifiant anonyme figure au compte rendu.</Alert>
            </Card>
          </div>
        </Section>

        <Section id="donnees" title="Données" lead="Indicateurs à anneau, graphiques (une seule couleur d’accent, comparaison en gris pointillé, infobulle au clavier, données toujours accessibles), tableaux et pagination.">
          <section className="kpi-row" aria-label="Exemples d’indicateurs">
            <KpiRing label="Analyses ce mois-ci" value={17} ring={81} delta="+13 % vs mois dernier" dir="up" good />
            <KpiRing label="À relire" value={2} ring={12} delta="+1 depuis hier" dir="up" good={false} tone="warning" />
            <KpiRing label="Détections relues" value={54} ring={74} delta="+9 cette semaine" dir="up" good tone="navy" />
            <KpiRing label="mAP@50 · Toutes classes" icon="chart" value="à renseigner" ring={null} dir="flat" />
          </section>
          <div className="dash-grid">
            <section className="dcard span-8" aria-label="Courbe">
              <div className="dcard-h">
                <div>
                  <h3>Courbe</h3>
                  <p>Exemple · données fictives</p>
                </div>
                <button ref={exportRef} type="button" className="icon-btn" aria-label="Exporter les données de la courbe en CSV">
                  <Icon name="download" />
                </button>
              </div>
              <LineChart
                exportRef={exportRef}
                title="Analyses par mois"
                labels={MONTHS.labels}
                year={MONTHS.year}
                summary="Hausse régulière."
                series={[
                  { name: "12 derniers mois", role: "accent", values: [9, 11, 8, 12, 14, 13, 10, 16, 14, 21, 15, 17] },
                  { name: "Année précédente", role: "context", values: [6, 7, 7, 9, 8, 10, 9, 11, 10, 12, 13, 12] },
                ]}
              />
            </section>
            <section className="dcard span-4 signature" aria-label="Jauge">
              <div className="dcard-h">
                <div>
                  <h3>Jauge</h3>
                  <p>Exemple · données fictives</p>
                </div>
              </div>
              <Gauge value={74} label="Détections relues" caption="54 détections relues sur 73." />
            </section>
            <section className="dcard span-5" aria-label="Barres de progression">
              <div className="dcard-h">
                <div>
                  <h3>Barres de progression</h3>
                  <p>Exemple · données fictives</p>
                </div>
              </div>
              <ProgressList
                title="Détections par type"
                items={["caries", "deep_caries", "periapical_lesion", "impacted_tooth"].map((k, i) => ({ name: DETECTION_TYPES[k].label, abbr: DETECTION_TYPES[k].abbr, cls: DETECTION_TYPES[k].cls, value: [38, 27, 21, 14][i] }))}
              />
            </section>
            <section className="dcard span-7" aria-label="Histogramme">
              <div className="dcard-h">
                <div>
                  <h3>Histogramme</h3>
                  <p>Exemple · données fictives</p>
                </div>
              </div>
              <BarChart title="Analyses relues par semaine" labels={MONTHS.labels} values={[3, 4, 2, 5, 4, 6, 3, 5, 4, 7, 5, 4]} name="Analyses relues" trendName="Moyenne sur 3 semaines" summary="Entre 2 et 7 par semaine." />
            </section>
            <section className="dcard span-12" aria-label="État vide">
              <VizEmpty title="Pas encore de mesure réelle">Nous n’affichons aucun chiffre inventé.</VizEmpty>
            </section>
          </div>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Exemple de tableau</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">N°</th>
                  <th scope="col">ID anonyme</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="r">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["16/11/2026", "0042", "7F3A", "info", "Relecture en cours"],
                  ["15/11/2026", "0041", "2C91", "success", "Clôturée"],
                ].map(([d, n, id, tone, label]) => (
                  <tr key={n}>
                    <td>{d}</td>
                    <td>
                      <NumChip>{n}</NumChip>
                    </td>
                    <td>
                      <IdChip>{id}</IdChip>
                    </td>
                    <td>
                      <Badge tone={tone} dot>
                        {label}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button size="sm" variant="secondary">
                          Ouvrir
                        </Button>
                        <IconAction icon="file" label={`Compte rendu ${n}`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageCount={5} onChange={setPage} />
        </Section>

        <Section id="detections" title="Détections" lead="Palette Okabe-Ito, lisible par les daltoniens. La couleur n’est jamais seule : nom, abréviation et pointillé (ajout ou correction du praticien) l’accompagnent.">
          <div className="row-wrap">
            {Object.keys(DETECTION_TYPES).map((k) => (
              <span key={k} className="badge">
                <DetSwatch label={k} />
                {DETECTION_TYPES[k].label}
              </span>
            ))}
          </div>
          <div className="row-wrap">
            {Object.keys(DETECTION_TYPES).map((k) => (
              <TypeChip key={k} label={k} />
            ))}
          </div>
          <div className="viewer-demo">
            <svg viewBox="0 0 1200 600" role="img" aria-label="Radiographie simulée avec cadres de détection">
              <SimulatedPanoImage />
              {Object.values(PANO_TEETH).map((t) => (
                <rect key={t.fdi} x={t.box.x} y={t.box.y} width={t.box.w} height={t.box.h} rx="6" fill="none" stroke="#56B4E9" strokeWidth="1.2" opacity=".4" />
              ))}
              {demoDetections.map((d) => (
                <DetectionBox key={d.id} box={panoBoxFor(d.fdi, d.label)} label={d.label} fdi={d.fdi} confidence={d.confidence} dashed={d.source === "user" || d.status === "corrected"} />
              ))}
            </svg>
          </div>
        </Section>

        <Section id="etats" title="États communs" lead="Les états que partagent tous les écrans de l’application.">
          <div className="catalog">
            <Card pad>
              <div className="card-head">
                <h3>Écran vide</h3>
                <Badge>Historique sans analyse</Badge>
              </div>
              <div className="center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="illus ill-img" src="/medias/etat-vide.webp" width="1024" height="1024" alt="" aria-hidden="true" />
                <h4>Aucune analyse pour le moment</h4>
                <p className="muted" style={{ fontSize: "var(--text-sm)", maxWidth: "36ch" }}>
                  Déposez une radiographie panoramique : les analyses terminées apparaîtront ici.
                </p>
                <Button href="/nouvelle-analyse">
                  <Icon name="plus" />
                  Nouvelle analyse
                </Button>
              </div>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Chargement en squelettes</h3>
                <Badge>Tableau et carte</Badge>
              </div>
              <div role="status" aria-label="Chargement en cours" style={{ display: "grid", gap: "var(--space-4)" }}>
                <div className="table-wrap" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skel-row">
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                    </div>
                  ))}
                </div>
                <div className="card card-pad" aria-hidden="true" style={{ display: "grid", gap: "var(--space-3)" }}>
                  <Skeleton style={{ height: 18, width: "40%" }} />
                  <Skeleton style={{ height: 12 }} />
                  <Skeleton style={{ height: 12, width: "75%" }} />
                </div>
              </div>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Erreur de chargement</h3>
              </div>
              <Alert tone="danger" role="alert" title="Impossible de charger l’historique.">
                Le service ne répond pas.
                <div style={{ marginTop: "var(--space-3)" }}>
                  <Button size="sm" variant="secondary" onClick={() => toast("Nouvelle tentative lancée.")}>
                    <Icon name="refresh" />
                    Réessayer
                  </Button>
                </div>
              </Alert>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Confirmation de suppression</h3>
              </div>
              <p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
                Action destructrice : confirmation par saisie, inscrite au journal d’audit.
              </p>
              <Button variant="danger" onClick={() => setModalOpen(true)}>
                <Icon name="trash" />
                Supprimer l’analyse n° 0039
              </Button>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Accès refusé (403)</h3>
              </div>
              <div className="preview">
                <div className="center" style={{ padding: "var(--space-4) 0" }}>
                  <span className="avatar" style={{ width: 52, height: 52, background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
                    <Icon name="lock" />
                  </span>
                  <p className="mono muted" style={{ fontSize: "var(--text-sm)" }}>
                    Erreur 403
                  </p>
                  <h4 style={{ fontSize: "var(--text-xl)" }}>Accès refusé</h4>
                  <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                    Votre rôle (Praticien) ne donne pas accès à cette fonction. Si vous pensez qu’il s’agit d’une erreur, contactez l’administrateur de votre cabinet.
                  </p>
                </div>
              </div>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Session expirée</h3>
              </div>
              <div className="preview">
                <div className="modal" style={{ boxShadow: "var(--shadow-md)", width: "100%" }}>
                  <h2>Session expirée</h2>
                  <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
                    Votre session a expiré. Reconnectez-vous pour reprendre ; vos relectures enregistrées sont conservées.
                  </p>
                  <div className="modal-actions">
                    <Button href="/connexion?etat=expiree">Se reconnecter</Button>
                  </div>
                </div>
              </div>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Notification (toast)</h3>
              </div>
              <p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
                S’affiche en bas à droite et se ferme seule.
              </p>
              <div className="btn-row">
                <Button variant="secondary" onClick={() => toast("Détection validée : dent 36, carie profonde.")}>
                  Notification de succès
                </Button>
                <Button variant="secondary" onClick={() => toast("La génération a échoué. Réessayez.")}>
                  Notification d’erreur
                </Button>
              </div>
            </Card>
            <Card pad>
              <div className="card-head">
                <h3>Hors ligne</h3>
              </div>
              <div className="offline-banner" role="status">
                <Icon name="alert" />
                <span>
                  <strong>Connexion perdue.</strong> Vous êtes hors ligne. Vos modifications seront envoyées au retour du réseau.
                </span>
              </div>
            </Card>
          </div>
        </Section>
      </main>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} labelledBy="m-del-t">
        <h2 id="m-del-t">Supprimer l’analyse n° 0039 ?</h2>
        <p style={{ fontSize: "var(--text-sm)" }}>Cette action est définitive : l’image, les détections et le compte rendu seront effacés. Elle sera inscrite au journal d’audit.</p>
        <Field label="Tapez SUPPRIMER pour confirmer" htmlFor="del-confirm">
          <Input id="del-confirm" autoComplete="off" spellCheck="false" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={confirm.trim() !== "SUPPRIMER"}
            onClick={() => {
              setModalOpen(false);
              setConfirm("");
              toast("Analyse n° 0039 supprimée (démonstration).");
            }}
          >
            Supprimer définitivement
          </Button>
        </div>
      </Modal>
    </div>
  );
}
