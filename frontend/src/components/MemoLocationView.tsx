import { MapPinIcon } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { Location } from "@/types/proto/api/v1/memo_service";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/Popover";

// Leaflet (~45kB gzip) is only needed once someone actually opens the location
// popover, so keep it out of the initial bundle.
const LeafletMap = lazy(() => import("./LeafletMap"));

interface Props {
  location: Location;
}

const MemoLocationView: React.FC<Props> = (props: Props) => {
  const { location } = props;
  const [popoverOpen, setPopoverOpen] = useState<boolean>(false);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <p className="w-full flex flex-row gap-0.5 items-center text-gray-500">
          <MapPinIcon className="w-4 h-auto shrink-0" />
          <span className="text-sm font-normal text-ellipsis whitespace-nowrap overflow-hidden">
            {location.placeholder ? location.placeholder : `[${location.latitude}, ${location.longitude}]`}
          </span>
        </p>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="min-w-80 sm:w-lg flex flex-col justify-start items-start">
          <Suspense fallback={<div className="w-full h-72 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-md" />}>
            <LeafletMap latlng={{ lat: location.latitude, lng: location.longitude }} readonly={true} />
          </Suspense>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MemoLocationView;
