// Photos the deck shows. Drop each file into public/present/ under this name and the slide picks
// it up; until then the slide shows a marked slot where the photo goes.
export const PHOTOS = {
  mitchells: { src: "/present/mitchells.jpg", alt: "Anthony Mitchell with his family" },
  mitchellsSmiling: { src: "/present/mitchells-boys.jpg", alt: "Anthony Mitchell smiling with two young boys" },
  station1: { src: "/present/station-1.jpg", alt: "Our visit to Palo Alto Fire Station 1" },
  station6: { src: "/present/station-6.jpg", alt: "Our visit to Palo Alto Fire Station 6" },
  roseland: { src: "/present/roseland.jpg", alt: "Roseland" },
} as const;

export type PhotoName = keyof typeof PHOTOS;
