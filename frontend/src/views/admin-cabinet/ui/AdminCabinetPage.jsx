import { useEffect, useRef, useState } from "react";

import { CABINET_LIMITS, fetchCabinet, removeCabinetLogo, saveCabinet, uploadCabinetLogo, validateCabinet, validateLogoFile } from "@/entities/cabinet";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDateTime, useAsyncResource } from "@/shared/lib";
import { Alert, Button, Field, Icon, Input, Textarea, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const EMPTY = { name: "", address: "", notes: "" };

/** En-tête du compte rendu tel qu'il sera imprimé : logo, nom, adresse ; mentions au pied. */
function HeaderPreview({ values, logoUrl }) {
  return (
    <div className="cab-preview" aria-label="Aperçu de l’en-tête du compte rendu">
      <div className="cab-preview-head">
        {logoUrl ? <img src={logoUrl} alt="" className="cab-preview-logo" /> : <span className="cab-preview-nologo">Sans logo</span>}
        <div>
          <strong>{values.name.trim() || "Nom du cabinet"}</strong>
          {values.address
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => (
              <span key={l}>{l}</span>
            ))}
        </div>
      </div>
      <div className="cab-preview-foot">
        <span>PanoraDent AI — prototype de recherche non certifié. Le praticien garde la décision.</span>
        {values.notes.trim() ? <span>{values.notes.trim()}</span> : null}
      </div>
    </div>
  );
}

/**
 * Paramètres du cabinet (sprint 8) : en-tête des comptes rendus — nom,
 * adresse, mentions, logo. Modification réservée à `cabinet:manage`,
 * journalisée par le serveur. La mention « prototype non certifié » est
 * fixée par le code : elle figure sur chaque page, quoi qu'on saisisse ici.
 */
export function AdminCabinetPage() {
  const toast = useToast();
  const cabinet = useAsyncResource(fetchCabinet);
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const data = cabinet.data;

  useEffect(() => {
    if (data) setValues({ name: data.name, address: data.address, notes: data.notes });
  }, [data]);

  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const dirty = Boolean(data) && (values.name !== data.name || values.address !== data.address || values.notes !== data.notes);

  const run = async (action, success) => {
    setBusy(true);
    setError(null);
    try {
      cabinet.setData(await action());
      toast(success);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (event) => {
    event.preventDefault();
    const invalid = validateCabinet(values);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(() => saveCabinet(values), "Paramètres du cabinet enregistrés.");
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateLogoFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(() => uploadCabinetLogo(file), "Logo importé.");
  };

  return (
    <AppShell page="admin-cabinet" title="Cabinet" crumbs="Administration" permission={Permission.CABINET_MANAGE} className="v-admin-cabinet">
      <div className="page-head">
        <div>
          <h2>Cabinet</h2>
          <p>En-tête des comptes rendus : nom, adresse, logo et mentions propres au cabinet.</p>
        </div>
      </div>

      {cabinet.error ? (
        <Alert tone="danger" role="alert">
          {cabinet.error.message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}

      <div className="cab-grid">
        <form className="card card-pad form" onSubmit={save} aria-labelledby="h-cab" noValidate>
          <div className="card-head">
            <h3 id="h-cab">Identité du cabinet</h3>
          </div>
          <Field label="Nom du cabinet" htmlFor="cab-nom" hint={`${values.name.length} / ${CABINET_LIMITS.name}`}>
            <Input id="cab-nom" value={values.name} maxLength={CABINET_LIMITS.name} required onChange={set("name")} disabled={!data || busy} />
          </Field>
          <Field label="Adresse" htmlFor="cab-adresse" hint="Une ligne par ligne d’adresse.">
            <Textarea id="cab-adresse" rows={3} value={values.address} maxLength={CABINET_LIMITS.address} onChange={set("address")} disabled={!data || busy} />
          </Field>
          <Field
            label="Mentions du cabinet (facultatives)"
            htmlFor="cab-mentions"
            hint="Ajoutées au pied de chaque page, après la mention « prototype non certifié », qui reste obligatoire."
          >
            <Textarea id="cab-mentions" rows={3} value={values.notes} maxLength={CABINET_LIMITS.notes} onChange={set("notes")} disabled={!data || busy} />
          </Field>
          <div className="btn-row">
            <Button type="submit" disabled={!dirty || busy}>
              Enregistrer
            </Button>
            {data?.updatedAt ? (
              <span className="hint">
                Modifié le {formatDateTime(data.updatedAt)}
                {data.updatedBy ? ` par ${data.updatedBy}` : ""}
              </span>
            ) : null}
          </div>
        </form>

        <section className="card card-pad" aria-labelledby="h-logo">
          <div className="card-head">
            <h3 id="h-logo">Logo</h3>
          </div>
          <p className="hint">PNG, JPEG ou WebP, 1 Mo au plus. Il est réduit dans un cadre de 800 × 300 px, proportions gardées.</p>
          <div className="cab-logo">{data?.logoUrl ? <img src={data.logoUrl} alt="Logo du cabinet" /> : <span>Aucun logo</span>}</div>
          <div className="btn-row">
            <input ref={inputRef} type="file" accept={LOGO_TYPES.join(",")} hidden onChange={onFile} data-testid="cab-logo-input" />
            <Button variant="secondary" size="sm" disabled={!data || busy} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" /> {data?.hasLogo ? "Changer le logo" : "Importer un logo"}
            </Button>
            {data?.hasLogo ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(removeCabinetLogo, "Logo retiré.")}>
                Retirer le logo
              </Button>
            ) : null}
          </div>
        </section>

        <section className="card card-pad cab-wide" aria-labelledby="h-apercu">
          <div className="card-head">
            <h3 id="h-apercu">Aperçu de l’en-tête</h3>
          </div>
          <HeaderPreview values={values} logoUrl={data?.logoUrl} />
        </section>
      </div>
    </AppShell>
  );
}
