// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { SongEditor } from '../../pages/SongEditor';

export default function SongEditorRoute() {
  return <KeyedByBandId Component={SongEditor} />;
}
