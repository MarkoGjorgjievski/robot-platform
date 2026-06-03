export type LiveCorpusEntry = {
  label: string;
  url: string;
  pageType: 'detail' | 'listing';
  /** Field names to request. Use ['discover'] to let analyze propose. */
  fields: string[];
  /** Fields we expect to NOT be on this page — counted as "absent" in reports, not "miss". */
  knownAbsentFields?: string[];
};

export const liveCorpus: LiveCorpusEntry[] = [
  {
    label: 'ikea-kallax',
    url: 'https://www.ikea.com/us/en/p/kallax-shelf-unit-white-80275887/',
    pageType: 'detail',
    fields: ['discover'],
  },
  {
    label: 'newegg-samsung-9100-pro',
    url: 'https://www.newegg.com/samsung-2tb-9100-pro-nvme-2-0/p/N82E16820147903',
    pageType: 'detail',
    fields: ['discover'],
    knownAbsentFields: ['variants'],
  },
];
