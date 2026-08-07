// src/content/testimonials.ts
// Single source of truth for athlete testimonials. Lifted out of landing.tsx so
// the homepage and every use-case page reference the same quotes by name — a
// wording edit here propagates everywhere.

export type Testimonial = { name: string; title: string; quote: string };

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Vincent Anthony Jr.",
    title: "Professional Football Player",
    quote:
      "Trench Sports is the new and improved way for athletes, especially football players, to train. The pad helps me learn and track how much force I'm applying and how accurate my punch is. Especially being a Defensive Lineman, this pad will help and elevate my game to the next level!",
  },
  {
    name: "Tyshon Reed",
    title: "D1 Football Player",
    quote:
      "Trench Sports' new pad is honestly really cool. What stood out to me most was being able to see where I hit and how hard I hit in real time — it adds a whole new level to training. It's not just reps anymore, it's feedback you can actually use. Definitely a game changer.",
  },
  {
    name: "Wes Williams",
    title: "Professional Football Player",
    quote:
      "I really like what Trench Sports is doing because it gives you data you can actually use. Instead of just feeling like you're getting better, you can see it. I think it can be a huge asset during the season for staying sharp and just as valuable in the offseason for tracking progress and getting the most out of every workout.",
  },
  {
    name: "Brandon Johnson",
    title: "Professional Football Player",
    quote:
      "As a defensive back, every rep matters. Trench Sports brings a new level of measurable data to player development that helps athletes and coaches see progress they couldn't quantify before. It's exciting to see technology like this pushing football training forward, and I think it has the potential to change how players develop at every level.",
  },
  {
    name: "Jon Gullette",
    title: "D1 Football Player · Campbell University",
    quote:
      "What I like about Trench Sports is that it gives you real feedback on the work you're putting in. Every rep matters, and being able to see the data behind your performance helps you understand where you're improving and what you need to keep working on. I think it's something athletes at every level can benefit from.",
  },
];

const BY_NAME = new Map(TESTIMONIALS.map((t) => [t.name, t]));

/** Resolve testimonials by name, preserving the requested order. Unknown names
 *  are dropped (with a dev warning) rather than throwing, so a typo in a content
 *  file can't blank a whole page. */
export function getTestimonials(names: string[]): Testimonial[] {
  return names
    .map((n) => {
      const t = BY_NAME.get(n);
      if (!t && import.meta.env?.DEV) {
        console.warn(`[testimonials] unknown name referenced: "${n}"`);
      }
      return t;
    })
    .filter((t): t is Testimonial => Boolean(t));
}
