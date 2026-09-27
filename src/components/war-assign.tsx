"use client";

// The war board's two pickers: "who hits this base?" from a base card, and
// "which base does this member hit?" from a lineup row.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULES THEY SHOW (enforced by the definer functions, 047 and 050)
//
//   - An enemy base holds ONE member. A held base is shown locked, with the
//     holder's name, and offers "remove" instead of "assign".
//   - A member holds as many bases as they have attacks left to plan: attacks
//     allowed, minus attacks used, minus bases they hold but have not hit yet.
//     Two left, two bases; one left, one; none, no picker.
//   - "Move" swaps one of a member's bases for another in one step.
//
// The server is still the authority: a base shown free here that somebody took
// a second ago is refused there, by name, and the toast says so.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A PROVIDER RATHER THAN SERVER-RENDERED LISTS
//
// A 30-base war has 30 base cards and 30 lineup rows, and each picker lists the
// other side: rendered on the server that is ~1,800 little forms serialised into
// every page load, of which a leader opens one. The war plan goes down ONCE, in
// the provider; each button builds its list from it only when opened.
//
// Saves go through ActionForm (no redirect, no remount). The page keys each
// button on the plan it shows, so when a save changes the plan the button
// remounts — closed — with the new state. A refusal leaves the key alone and
// the dialog open, beside the toast explaining why.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState } from "react";
import { ArrowRightLeft, Crosshair, Lock, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActionForm, type ResultAction } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { TownHall } from "@/components/game/town-hall";

export interface PlanMember {
  playerId: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
  attacksUsed: number;
  attacksAllowed: number;
  /** Every base this member holds, attacked or not. */
  targets: number[];
  /** How many more bases they can be given (attacks left minus open targets). */
  slotsLeft: number;
}

export interface PlanBase {
  position: number;
  name: string | null;
  thLevel: number | null;
  bestStars: number | null;
  /** Who holds it. One at most since 047, but older wars may carry two. */
  assignedTo: Array<{ playerId: string; name: string }>;
}

export interface WarPlan {
  action: ResultAction;
  clanTag: string;
  warId: string;
  members: PlanMember[];
  bases: PlanBase[];
}

const PlanContext = createContext<WarPlan | null>(null);

export function WarPlanProvider({ plan, children }: { plan: WarPlan; children: React.ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

function usePlan(): WarPlan {
  const plan = useContext(PlanContext);
  if (!plan) throw new Error("WarPlanProvider is missing");
  return plan;
}

function AssignForm({
  plan,
  playerId,
  position,
  replace,
  children,
  label,
}: {
  plan: WarPlan;
  playerId: string;
  position: number;
  replace?: number;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <ActionForm
      action={plan.action}
      hidden={{
        clanTag: plan.clanTag,
        warId: plan.warId,
        action: "assign",
        playerId,
        position: String(position),
        ...(replace !== undefined ? { replace: String(replace) } : {}),
      }}
    >
      <SubmitButton size="sm" pendingLabel="Saving" aria-label={label}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

function attacksLeftText(m: PlanMember): string {
  const left = Math.max(0, m.attacksAllowed - m.attacksUsed);
  return `${left} attack${left === 1 ? "" : "s"} left`;
}

/** From a base card: choose the member who hits this base. */
export function AssignBaseButton({ position }: { position: number }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const base = plan.bases.find((b) => b.position === position);
  const holder = base?.assignedTo[0] ?? null;

  // Members with no base yet first — they are who a leader is placing — then
  // members with a base already and an attack still unplanned.
  const withSlots = plan.members.filter((m) => m.slotsLeft > 0);
  const fresh = withSlots.filter((m) => m.targets.length === 0);
  const extra = withSlots.filter((m) => m.targets.length > 0);
  const full = plan.members.length - withSlots.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline" className="relative z-10">
          {holder ? <Crosshair aria-hidden /> : <UserPlus aria-hidden />}
          {holder ? "Change" : "Assign"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Base {position}
            {base?.name ? ` · ${base.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {holder ? (
              <>
                Held by <span className="text-foreground font-medium">{holder.name}</span>. A base
                takes one member — remove {holder.name} first to give it to someone else.
              </>
            ) : (
              "Pick the member who should hit this base."
            )}
          </DialogDescription>
        </DialogHeader>
        {holder ? (
          <ActionForm
            action={plan.action}
            hidden={{
              clanTag: plan.clanTag,
              warId: plan.warId,
              action: "clear",
              playerId: holder.playerId,
              position: String(position),
            }}
            className="flex justify-end"
          >
            <SubmitButton size="sm" variant="outline" pendingLabel="Removing">
              Remove {holder.name} from base {position}
            </SubmitButton>
          </ActionForm>
        ) : (
          <DialogBody className="space-y-4">
            <MemberList
              title="No base yet"
              members={fresh}
              empty="Everyone with an attack left already has a base."
              render={(m) => (
                <AssignForm plan={plan} playerId={m.playerId} position={position} label={`Assign ${m.name} to base ${position}`}>
                  Assign
                </AssignForm>
              )}
            />
            {extra.length > 0 && (
              <MemberList
                title="Add as another base"
                members={extra}
                render={(m) => (
                  <AssignForm plan={plan} playerId={m.playerId} position={position} label={`Also give ${m.name} base ${position}`}>
                    Add
                  </AssignForm>
                )}
              />
            )}
            {full > 0 && (
              <p className="text-muted-foreground text-xs">
                {full} member{full === 1 ? " has" : "s have"} no attack left to plan and {full === 1 ? "is" : "are"} not listed.
              </p>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberList({
  title,
  members,
  empty,
  render,
}: {
  title: string;
  members: PlanMember[];
  empty?: string;
  render: (m: PlanMember) => React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title} <span className="tabular-nums">({members.length})</span>
      </h3>
      {members.length === 0 ? (
        empty ? <p className="text-muted-foreground text-sm">{empty}</p> : null
      ) : (
        <ul className="divide-y rounded-control border">
          {members.map((m) => (
            <li key={m.playerId} className="flex items-center gap-3 px-3 py-2">
              <span className="text-muted-foreground w-7 text-xs tabular-nums">#{m.mapPosition ?? "?"}</span>
              <TownHall level={m.thLevel} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.name}</span>
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {attacksLeftText(m)}
                  {m.targets.length > 0 ? ` · on base ${m.targets.join(", ")}` : ""}
                </span>
              </span>
              {render(m)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * From a lineup row: give this member a base, or — with `replace` — move them
 * off that base onto another.
 */
export function AssignMemberButton({ playerId, replace }: { playerId: string; replace?: number }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const member = plan.members.find((m) => m.playerId === playerId);
  if (!member) return null;
  const moving = replace !== undefined;

  const takenBy = (b: PlanBase) => b.assignedTo.find((a) => a.playerId !== playerId) ?? null;
  const choices = plan.bases.filter((b) => !takenBy(b) && !member.targets.includes(b.position));
  const untouched = choices.filter((b) => b.bestStars === null);
  const hit = choices.filter((b) => b.bestStars !== null);
  const taken = plan.bases.filter((b) => takenBy(b));
  const verb = moving ? "Move here" : "Assign";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline" aria-label={moving ? `Move ${member.name} off base ${replace}` : undefined}>
          {moving ? <ArrowRightLeft aria-hidden /> : <Crosshair aria-hidden />}
          {moving ? "Move" : member.targets.length ? `Add base (${member.slotsLeft} left)` : "Assign base"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {moving ? `Move ${member.name} off base ${replace}` : `Base for ${member.name}`}
          </DialogTitle>
          <DialogDescription>
            {attacksLeftText(member)}
            {member.targets.length ? ` · holds base ${member.targets.join(", ")}` : ""}. Bases another member holds are
            locked.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <BaseList
            title="Free"
            bases={untouched}
            empty="No untouched base is left."
            render={(b) => (
              <AssignForm plan={plan} playerId={playerId} position={b.position} replace={replace} label={`${verb}: base ${b.position} for ${member.name}`}>
                {verb}
              </AssignForm>
            )}
          />
          {hit.length > 0 && (
            <BaseList
              title="Attacked, nobody assigned"
              bases={hit}
              render={(b) => (
                <AssignForm plan={plan} playerId={playerId} position={b.position} replace={replace} label={`${verb}: base ${b.position} for ${member.name}`}>
                  {verb}
                </AssignForm>
              )}
            />
          )}
          {taken.length > 0 && (
            <BaseList
              title="Taken"
              bases={taken}
              render={(b) => (
                <Badge variant="outline" className="shrink-0">
                  <Lock aria-hidden />
                  {takenBy(b)!.name}
                </Badge>
              )}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function BaseList({
  title,
  bases,
  empty,
  render,
}: {
  title: string;
  bases: PlanBase[];
  empty?: string;
  render: (b: PlanBase) => React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title} <span className="tabular-nums">({bases.length})</span>
      </h3>
      {bases.length === 0 ? (
        empty ? <p className="text-muted-foreground text-sm">{empty}</p> : null
      ) : (
        <ul className="divide-y rounded-control border">
          {bases.map((b) => (
            <li key={b.position} className="flex items-center gap-3 px-3 py-2">
              <span className="cb-title w-8 text-lg tabular-nums">{b.position}</span>
              <TownHall level={b.thLevel} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {b.name ?? <span className="text-muted-foreground">Unknown</span>}
                </span>
                {b.bestStars !== null && (
                  <span className="text-muted-foreground block text-xs">
                    Best so far: {b.bestStars}★
                  </span>
                )}
              </span>
              {render(b)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
