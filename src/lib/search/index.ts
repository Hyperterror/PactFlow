import { prisma } from "@/lib/prisma";

/**
 * Cross-entity search for the command palette.
 *
 * Scope is deliberately narrow: only records the caller can already open, and
 * only text that identifies them. This is a way to *reach* an engagement you
 * know exists, not a document index.
 */
export interface SearchHit {
  id: string;
  kind: "Brief" | "Agreement" | "Milestone";
  title: string;
  subtitle: string;
  href: string;
}

const MAX_PER_KIND = 5;

export async function searchEverything(userId: string, query: string): Promise<SearchHit[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const [briefs, agreements, milestones] = await Promise.all([
    prisma.brief.findMany({
      where: {
        OR: [
          { clientId: userId },
          { invitations: { some: { freelancerId: userId } } },
        ],
        AND: [
          {
            OR: [
              { title: { contains: term } },
              { description: { contains: term } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_KIND,
      select: { id: true, title: true, status: true },
    }),

    prisma.agreement.findMany({
      where: {
        OR: [{ clientId: userId }, { freelancerId: userId }],
        brief: { title: { contains: term } },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_KIND,
      select: {
        id: true,
        status: true,
        currentVersion: true,
        brief: { select: { title: true } },
      },
    }),

    prisma.milestone.findMany({
      where: {
        name: { contains: term },
        agreement: { OR: [{ clientId: userId }, { freelancerId: userId }] },
      },
      orderBy: { dueDate: "asc" },
      take: MAX_PER_KIND,
      select: { id: true, name: true, status: true, agreementId: true },
    }),
  ]);

  return [
    ...briefs.map<SearchHit>((brief) => ({
      id: brief.id,
      kind: "Brief",
      title: brief.title,
      subtitle: brief.status,
      href: `/briefs/${brief.id}`,
    })),
    ...agreements.map<SearchHit>((agreement) => ({
      id: agreement.id,
      kind: "Agreement",
      title: agreement.brief.title,
      subtitle: `${agreement.status} · version ${agreement.currentVersion}`,
      href: `/agreements/${agreement.id}`,
    })),
    ...milestones.map<SearchHit>((milestone) => ({
      id: milestone.id,
      kind: "Milestone",
      title: milestone.name,
      subtitle: milestone.status,
      href: `/delivery/${milestone.id}`,
    })),
  ];
}
