import { describe, expect, it } from "vitest";

import { AppError, ErrorCode } from "@/shared/api";

import { describeAgent } from "../../profil/ui/ProfilPage";
import { GOOGLE_ERRORS, passwordLoginNotice } from "./ConnexionPage";

const refus = (status, code, message) => new AppError(ErrorCode.VALIDATION, message, { status, serverCode: code });

describe("écran de connexion : refus du formulaire", () => {
  it("identifiants refusés : le message neutre du serveur, tel quel", () => {
    const notice = passwordLoginNotice(refus(401, "identifiants_invalides", "Adresse e-mail ou mot de passe incorrect."));
    expect(notice).toEqual({ tone: "danger", code: "identifiants_invalides", text: "Adresse e-mail ou mot de passe incorrect." });
  });

  it("compte verrouillé : durée restante donnée par le serveur", () => {
    const notice = passwordLoginNotice(refus(423, "compte_verrouille", "Trop de tentatives échouées. Réessayez dans 15 minutes."));
    expect(notice.title).toBe("Compte verrouillé temporairement");
    expect(notice.text).toMatch(/15 minutes/);
  });

  it("compte désactivé", () => {
    expect(passwordLoginNotice(refus(403, "compte_desactive", "Ce compte est désactivé.")).title).toBe("Compte désactivé");
  });

  it("panne réseau : encart neutre, sans parler d'identifiants", () => {
    const notice = passwordLoginNotice(new AppError(ErrorCode.NETWORK));
    expect(notice.retry).toBe(true);
    expect(notice.text).toMatch(/Backend injoignable/);
  });

  it("chaque code de retour Google a son message", () => {
    for (const code of ["compte_inconnu", "compte_desactive", "google_non_autorise", "google_non_rattache", "adresse_non_verifiee", "etat_invalide", "echec_google"]) {
      expect(GOOGLE_ERRORS[code]?.text, code).toBeTruthy();
    }
  });
});

describe("profil : appareil d'une session", () => {
  it("reconnaît navigateur et système", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    expect(describeAgent(chrome)).toBe("Chrome · Windows");
    expect(describeAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0")).toBe("Firefox · macOS");
    expect(describeAgent("")).toBe("Appareil inconnu");
  });
});
