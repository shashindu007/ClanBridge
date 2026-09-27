"use client";

// The war board's two pickers: "who hits this base?" from a base card, and
// "which base does this member hit?" from a lineup row.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A PROVIDER RATHER THAN SERVER-RENDERED LISTS
//
// A 30-base war has 30 base cards and 30 lineup rows, and each picker lists the
// other side: rendered on the server that is ~1,800 little forms serialised into
// every page load, of which a leader opens one. The war plan goes down ONCE, in
// the provider; each button builds its list from it only when opened.
//
// The forms still post to the page's own server action, and the definer
// functions in 047 are still the authority: a base shown free here that
// somebody took a second ago is refused there, by name, and the toast says so.
//
// Closing after a save: the page keys each button on the assignment it shows,
// so when an assignment changes the button remounts — closed — with the new
// state. An error leaves the key unchanged and the dialog open, next to the
// toast explaining why.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState } from "react";
import { Crosshair, Lock, UserPlus } from "lucide-react";
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
import { SubmitButton } from "@/components/submit-button";
import { TownHall } from "@/components/game/town-hall";

export interface PlanMember {
  playerId: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
  attacksUsed: number;
  attacksAllowed: number;
  targetPosition: number | null;
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
  action: (formData: FormData) => void | Promise<void>;
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
  children,
  label,
}: {
  plan: WarPlan;
  playerId: string;
  position: number;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <form action={plan.action}>
      <input type="hidden" name="clanTag" value={plan.clanTag} />
      <input type="hidden" name="warId" value={plan.warId} />
      <input type="hidden" name="action" value="assign" />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="position" value={position} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Saving" aria-label={label}>
        {children}
      </SubmitButton>
    </form>
  );
}

/** From a base card: choose the member who hits this base. */
export function AssignBaseButton({ position }: { position: number }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const base = plan.bases.find((b) => b.position === position);
  const holder = base?.assignedTo[0] ?? null;

  // Members with no target first — they are who a leader is placing — then
  // everyone else, who would MOVE here from the base they hold.
  const free = plan.members.filter((m) => m.targetPosition === null);
  const moving = plan.members.filter(
    (m) => m.targetPosition !== null && m.targetPosition !== position,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant={holder ? "ghost" : "outline"} className="relative z-10">
          <UserPlus aria-hidden />
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
                takes one member — clear or move {holder.name} first to give it to someone else.
              </>
            ) : (
              "Pick the member who should hit this base."
            )}
          </DialogDescription>
        </DialogHeader>
        {holder && (
          <form action={plan.action} className="flex justify-end">
            <input type="hidden" name="clanTag" value={plan.clanTag} />
            <input type="hidden" name="warId" value={plan.warId} />
            <input type="hidden" name="action" value="clear" />
            <input type="hidden" name="playerId" value={holder.playerId} />
            <SubmitButton size="sm" variant="outline" pendingLabel="Removing">
              Remove {holder.name} from base {position}
            </SubmitButton>
          </form>
        )}
        {!holder && (
          <DialogBody className="space-y-4">
            <MemberList
              title="No target yet"
              members={free}
              empty="Everyone already has a target."
              render={(m) => (
                <AssignForm plan={plan} playerId={m.playerId} position={position} label={`Assign ${m.name} to base ${position}`}>
                  Assign
                </AssignForm>
              )}
            />
            {moving.length > 0 && (
              <MemberList
                title="Move from another base"
                members={moving}
                render={(m) => (
                  <AssignForm plan={plan} playerId={m.playerId} position={position} label={`Move ${m.name} to base ${position}`}>
                    Move here
                  </AssignForm>
                )}
              />
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
                  {m.attacksUsed} of {m.attacksAllowed} attacks used
                  {m.targetPosition !== null ? ` · on base ${m.targetPosition}` : ""}
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

/** From a lineup row: choose the base this member hits. */
export function AssignMemberButton({ playerId }: { playerId: string }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const member = plan.members.find((m) => m.playerId === playerId);
  if (!member) return null;

  const takenBy = (b: PlanBase) => b.assignedTo.find((a) => a.playerId !== playerId) ?? null;
  const current = plan.bases.find((b) => b.position === member.targetPosition) ?? null;
  const open_ = plan.bases.filter((b) => !takenBy(b) && b.position !== member.targetPosition);
  const untouched = open_.filter((b) => b.bestStars === null);
  const hit = open_.filter((b) => b.bestStars !== null);
  const taken = plan.bases.filter((b) => takenBy(b));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <Crosshair aria-hidden />
          {member.targetPosition !== null ? "Change" : "Assign"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Target for {member.name}</DialogTitle>
          <DialogDescription>
            {current
              ? `Currently on base ${current.position}. Pick another to move them.`
              : "Pick an enemy base. Bases another member holds are locked."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <BaseList
            title="Free"
            bases={untouched}
            empty="No untouched base is left."
            render={(b) => (
              <AssignForm plan={plan} playerId={playerId} position={b.position} label={`Assign base ${b.position} to ${member.name}`}>
                Assign
              </AssignForm>
            )}
          />
          {hit.length > 0 && (
            <BaseList
              title="Attacked, nobody assigned"
              bases={hit}
              render={(b) => (
                <AssignForm plan={plan} playerId={playerId} position={b.position} label={`Assign base ${b.position} to ${member.name}`}>
                  Assign
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
