import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { TYPE_LABELS, addNote, nameRefusal, type FieldType } from '../../lib/fields-view';
import { trpc } from '../../lib/trpc';

/**
 * The catalogue: what a customer scraping a product page (or a job, a property,
 * an article) usually wants, as chips they add with one click.
 *
 * It is a wall of chips rather than a list with checkboxes because the work
 * here is recognition, not reading — the customer is looking for the two or
 * three names they already have in mind, and a chip wall lets the eye sweep a
 * group in one pass. The type rides along in mono so the choice is never blind:
 * "Price — Money" is a different promise from "Price — Text".
 */
export function FieldCatalogue({
  datasetId,
  existingNames,
  websiteCount,
  onAddYourOwn,
}: {
  datasetId: string;
  /** The contract's names, to grey out what is already in it. */
  existingNames: string[];
  websiteCount: number;
  onAddYourOwn: () => void;
}) {
  const utils = trpc.useUtils();
  const catalogue = trpc.datasets.catalogue.useQuery();
  const add = trpc.datasets.addField.useMutation();
  const [type, setType] = useState('product');
  // The chips with a request in flight, so only those go quiet. Picking six
  // fields is one gesture repeated six times, and freezing the whole wall for
  // each round trip would turn it into six waits. The API is built for it:
  // `addField` locks the dataset row, so overlapping adds queue rather than
  // overwrite each other.
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());

  // `assertNameFree` refuses a duplicate name case-insensitively, so that is the
  // comparison the chips have to make — otherwise "SKU" would offer to add a
  // field the project already has as "Sku", and the click would only fail.
  const taken = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );

  async function addEntry(entry: { key: string; name: string; type: FieldType; description: string; concept: string }) {
    setAdding((s) => new Set(s).add(entry.key));
    try {
      await add.mutateAsync({
        datasetId,
        name: entry.name,
        type: entry.type,
        // The catalogue knows both, and neither can be guessed back from the
        // name: the description is the website's default location hint, and the
        // concept is what the field IS to the extraction cache.
        description: entry.description,
        concept: entry.concept,
      });
      await Promise.all([
        utils.projects.get.invalidate(),
        utils.datasets.fieldStatus.invalidate({ datasetId }),
        // `projects.list` carries the project's field count, so /projects would
        // show the old number for the rest of its 30 s staleTime.
        utils.projects.list.invalidate(),
      ]);
      // The project-wide consequence is the news, when there is one.
      toast(addNote(websiteCount) ?? 'Field added');
    } catch (err) {
      toast.error(nameRefusal(err, entry.name) ?? 'That field could not be added.');
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(entry.key);
        return next;
      });
    }
  }

  return (
    // `min-w-0`: a grid item's default minimum is its content, and the chips'
    // widest row would otherwise push the whole page wider than the phone.
    <div className="rise min-w-0 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      {/* The same metrics as a table head, so the two panels start on one line
          when they sit side by side. */}
      <h2 className="border-b border-line px-4 py-2 text-sm font-normal text-muted-foreground">
        Add from the catalogue
      </h2>

      <div className="p-4">
        {catalogue.isPending ? <LoadingChips /> : null}

        {catalogue.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-base text-fail">
              Could not load the catalogue.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void catalogue.refetch()}
              disabled={catalogue.isFetching}
            >
              {catalogue.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : null}

        {catalogue.data ? (
          <Tabs value={type} onValueChange={setType}>
            {/* Seven labels do not fit on one line in this column at any width
                the grid gives it, so the list wraps rather than scrolls —
                a scrollbar would hide whole types behind an edge. */}
            <TabsList className="w-full flex-wrap justify-start gap-0.5 p-1 group-data-[orientation=horizontal]/tabs:h-auto">
              {Object.entries(catalogue.data).map(([key, group]) => (
                <TabsTrigger key={key} value={key} className="h-7 flex-none px-2.5">
                  {group.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {Object.entries(catalogue.data).map(([key, group]) => (
              <TabsContent key={key} value={key} className="mt-2 space-y-4">
                {group.groups.map((g) => (
                  <div key={g.name}>
                    <div className="mb-1.5 text-sm text-muted-foreground">{g.name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.entries.map((entry) => {
                        const already = taken.has(entry.name.trim().toLowerCase());
                        return (
                          <Button
                            key={entry.key}
                            variant="outline"
                            size="sm"
                            disabled={already || adding.has(entry.key)}
                            onClick={() => void addEntry(entry)}
                            // Chip metrics, not button metrics: 22 px tall and
                            // tight, so a group of thirteen reads as one texture
                            // rather than as thirteen commands.
                            className="h-[22px] gap-1.5 rounded-md px-2 font-normal"
                          >
                            {already ? <Check className="size-3" /> : null}
                            {entry.name}
                            <span className="font-mono text-sm text-muted-foreground">
                              {TYPE_LABELS[entry.type]}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* `custom` has no groups — it is the tab that admits the
                    catalogue cannot know everything. */}
                {group.groups.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-base text-muted-foreground">
                      Nothing to pick from here — name the field yourself.
                    </p>
                    <Button variant="outline" size="sm" onClick={onAddYourOwn}>
                      Add your own
                    </Button>
                  </div>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
      </div>
    </div>
  );
}

/** The shape of a loaded catalogue — a tab row and two groups of chips. */
function LoadingChips() {
  return (
    <div>
      <Skeleton className="h-8 w-full bg-raised" />
      {[0, 1].map((g) => (
        <div key={g} className="mt-3.5">
          <Skeleton className="mb-1.5 h-3 w-16 bg-raised" />
          <div className="flex flex-wrap gap-1.5">
            {[64, 92, 76, 108, 84].map((w, i) => (
              <Skeleton key={i} className="h-[22px] bg-raised" style={{ width: w }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
