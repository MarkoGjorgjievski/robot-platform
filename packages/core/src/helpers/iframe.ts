import { optionalWait, waitForFrameToLoad } from './wait.ts';
import { checkSelector } from './dom.ts';

export async function searchInFrame(context: any, frameSelector: string, listToSearch: string[]): Promise<boolean> {
  if (frameSelector === '') return false;
  await optionalWait(context, frameSelector);
  if (!await checkSelector(context, frameSelector, 'CSS')) return false;
  if (!await waitForFrameToLoad(context, frameSelector)) return false;
  try {
    return context.evaluateInFrame(frameSelector, (listToSearch: string[]) => {
      if (document && document.body) {
        return listToSearch.some(txt => document.body.innerText.search(txt) > -1);
      }
      return false;
    }, listToSearch);
  } catch (error) {
    console.log(error);
    return false;
  }
}

export async function searchInFullPage(context: any, frameSelector: string, listToSearch: string[]): Promise<boolean> {
  return await context.evaluate((listToSearch: string[]) => {
    if (document && document.body) {
      return listToSearch.some(txt => document.body.innerText?.search(txt) > -1);
    }
    return false;
  }, listToSearch) || await searchInFrame(context, frameSelector, listToSearch).catch(() => false);
}

