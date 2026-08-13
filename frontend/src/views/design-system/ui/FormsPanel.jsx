import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, LoaderCircle, Search, Upload } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import {
  Button,
  Calendar,
  Checkbox,
  FilePicker,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Switch,
  Textarea,
} from "@/shared/ui";

import { Canvas, Code, Section, Specimen } from "./Section";

/**
 * Schéma de la revue praticien telle qu'elle est envisagée. Il ne s'agit que
 * d'une démonstration : rien n'est envoyé au backend.
 */
const reviewSchema = z.object({
  fdi: z
    .string()
    .regex(/^[1-4][1-8]$/, "Numéro FDI invalide (quadrant 1-4, dent 1-8)"),
  label: z.string().min(1, "Sélectionnez une classe"),
  comment: z.string().max(280, "280 caractères maximum").optional(),
  confirmed: z.boolean().refine((value) => value === true, {
    message: "La validation du praticien est obligatoire",
  }),
});

function ReviewFormDemo() {
  const form = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: { fdi: "", label: "", comment: "", confirmed: false },
  });

  function onSubmit(values) {
    toast.success("Détection validée (démonstration)", {
      description: `FDI ${values.fdi} · ${values.label}`,
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-6">
        <FormField
          control={form.control}
          name="fdi"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Numéro FDI</FormLabel>
              <FormControl>
                <Input placeholder="11" inputMode="numeric" {...field} />
              </FormControl>
              <FormDescription>
                Numérotation dentaire internationale : quadrant puis position.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Classe corrigée</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir une classe" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="tooth">Dent</SelectItem>
                  <SelectItem value="caries">Carie</SelectItem>
                  <SelectItem value="deep_caries">Carie profonde</SelectItem>
                  <SelectItem value="periapical_lesion">Lésion périapicale</SelectItem>
                  <SelectItem value="impacted_tooth">Dent incluse</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Commentaire</FormLabel>
              <FormControl>
                <Textarea placeholder="Observation du praticien" rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmed"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1">
                <FormLabel>Je valide cette détection</FormLabel>
                <FormDescription>
                  La décision médicale relève exclusivement du praticien.
                </FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          )}
          Enregistrer la revue
        </Button>
      </form>
    </Form>
  );
}

export function FormsPanel() {
  const [threshold, setThreshold] = useState([55]);
  const [date, setDate] = useState(undefined);

  return (
    <div className="space-y-10">
      <Section
        title="Champs de saisie"
        description={
          <>
            <Code>Input</Code> et <Code>Textarea</Code>. L&apos;état d&apos;erreur
            passe par <Code>aria-invalid</Code> : il est donc annoncé aux
            technologies d&apos;assistance, pas seulement coloré.
          </>
        }
      >
        <Canvas className="block max-w-sm space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ds-fdi">Numéro FDI</Label>
            <Input id="ds-fdi" placeholder="11" inputMode="numeric" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-invalid">Champ en erreur</Label>
            <Input id="ds-invalid" defaultValue="99" aria-invalid="true" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-disabled">Champ désactivé</Label>
            <Input id="ds-disabled" defaultValue="mock-0.0.0" disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ds-textarea">Commentaire</Label>
            <Textarea id="ds-textarea" placeholder="Observation du praticien" rows={3} />
          </div>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Champs composés"
        description={
          <>
            <Code>InputGroup</Code> agrège une icône, une unité ou un bouton dans
            la même bordure que le champ.
          </>
        }
      >
        <Canvas className="block max-w-sm space-y-4">
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput placeholder="Rechercher une analyse" />
          </InputGroup>

          <InputGroup>
            <InputGroupInput placeholder="0.55" inputMode="decimal" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>seuil</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Listes de choix"
        description={
          <>
            <Code>Select</Code> (stylé, monté en portail) pour les choix riches ;{" "}
            <Code>NativeSelect</Code> quand le rendu natif du système est
            préférable — typiquement sur mobile.
          </>
        }
      >
        <Canvas className="items-start gap-6">
          <Specimen label="Select">
            <Select>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Classe de détection" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Normal</SelectLabel>
                  <SelectItem value="tooth">Dent</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Anomalies</SelectLabel>
                  <SelectItem value="caries">Carie</SelectItem>
                  <SelectItem value="deep_caries">Carie profonde</SelectItem>
                  <SelectItem value="periapical_lesion">Lésion périapicale</SelectItem>
                  <SelectItem value="impacted_tooth">Dent incluse</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Specimen>

          <Specimen label="NativeSelect">
            <NativeSelect defaultValue="mock" className="w-56">
              <NativeSelectOption value="mock">mock-0.0.0</NativeSelectOption>
              <NativeSelectOption value="real">yolov11-dentex-1.0.0</NativeSelectOption>
            </NativeSelect>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Choix binaires et multiples"
        description={
          <>
            <Code>Checkbox</Code> pour des options indépendantes,{" "}
            <Code>RadioGroup</Code> pour un choix exclusif, <Code>Switch</Code>{" "}
            pour un réglage qui s&apos;applique immédiatement.
          </>
        }
      >
        <Canvas className="items-start gap-10">
          <Specimen label="Checkbox">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="ds-c1" defaultChecked />
                <Label htmlFor="ds-c1">Afficher les dents</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="ds-c2" defaultChecked />
                <Label htmlFor="ds-c2">Afficher les anomalies</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="ds-c3" disabled />
                <Label htmlFor="ds-c3">Détections revues (à venir)</Label>
              </div>
            </div>
          </Specimen>

          <Specimen label="RadioGroup">
            <RadioGroup defaultValue="mock" className="space-y-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="mock" id="ds-r1" />
                <Label htmlFor="ds-r1">Inférence mock</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="real" id="ds-r2" />
                <Label htmlFor="ds-r2">Inférence réelle</Label>
              </div>
            </RadioGroup>
          </Specimen>

          <Specimen label="Switch">
            <div className="flex items-center gap-2">
              <Switch id="ds-s1" defaultChecked />
              <Label htmlFor="ds-s1">Superposer les boîtes</Label>
            </div>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Valeurs continues"
        description={
          <>
            <Code>Slider</Code> convient à un réglage dont la valeur exacte
            importe peu — ici le seuil de confiance d&apos;affichage.
          </>
        }
      >
        <Canvas className="block max-w-sm space-y-3">
          <div className="flex items-center justify-between text-sm">
            <Label htmlFor="ds-threshold">Seuil de confiance</Label>
            <span className="font-mono text-xs text-muted-foreground">
              {threshold[0]} %
            </span>
          </div>
          <Slider
            id="ds-threshold"
            value={threshold}
            onValueChange={setThreshold}
            min={0}
            max={100}
            step={5}
          />
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Code à usage unique"
        description={
          <>
            <Code>InputOTP</Code> — prévu pour une éventuelle authentification à
            deux facteurs du praticien.
          </>
        }
      >
        <Canvas>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Date"
        description={
          <>
            <Code>Calendar</Code> seul, ou associé à un <Code>Popover</Code> pour
            former un sélecteur de date compact.
          </>
        }
      >
        <Canvas className="items-start gap-6">
          <Specimen label="Popover + Calendar">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-56 justify-start font-normal">
                  <CalendarDays aria-hidden="true" />
                  {date ? date.toLocaleDateString("fr-FR") : "Choisir une date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={setDate} />
              </PopoverContent>
            </Popover>
          </Specimen>

          <Specimen label="Calendar — en ligne">
            <div className="rounded-lg border">
              <Calendar mode="single" selected={date} onSelect={setDate} />
            </div>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Sélecteur de fichier"
        description={
          <>
            Composant maison : shadcn n&apos;en fournit pas. Un label stylé comme
            un bouton masque l&apos;input, qui reste atteignable au clavier (
            <Code>sr-only</Code>, pas <Code>display:none</Code>).
          </>
        }
      >
        <Canvas>
          <Specimen label="au repos">
            <FilePicker accept=".dcm,image/*" onSelect={() => {}} size="lg">
              <Upload aria-hidden="true" />
              Importer une panoramique
            </FilePicker>
          </Specimen>
          <Specimen label="pendant l'analyse">
            <FilePicker accept=".dcm,image/*" onSelect={() => {}} size="lg" disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Analyse en cours…
            </FilePicker>
          </Specimen>
        </Canvas>
      </Section>

      <Separator />

      <Section
        title="Formulaire validé"
        description={
          <>
            <Code>Form</Code> assemble react-hook-form et un schéma zod : les
            messages d&apos;erreur, les <Code>aria-describedby</Code> et les
            identifiants de champs sont générés. Essayez de valider à vide — rien
            n&apos;est envoyé au backend.
          </>
        }
      >
        <Canvas className="block">
          <ReviewFormDemo />
        </Canvas>
      </Section>
    </div>
  );
}
