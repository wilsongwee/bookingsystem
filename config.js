// Booking rules and room list. Edit this file to adjust the system —
// no other code changes are needed for the common tweaks.
window.BOOKING_CONFIG = {
  // Operating hours (24h clock). Slots are generated from open to close.
  openHour: 8,
  closeHour: 18,

  // Length of one booking block, in hours.
  blockHours: 2,

  // Usage cap: maximum hours one person may hold per day, across all rooms.
  // Raise this (e.g. to 4) if utilisation data shows spare capacity.
  maxHoursPerPersonPerDay: 2,

  // How many days ahead people can book (0 = today only).
  bookingWindowDays: 7,

  // Allow weekend bookings?
  allowWeekends: false,

  // Rooms. `type` drives the filter chips; `capacity` is informational.
  rooms: [
    { id: "relax-1", name: "Relax Room 1", type: "Relax Room", location: "Lounge", capacity: 6 },
    { id: "relax-2", name: "Relax Room 2", type: "Relax Room", location: "Lounge", capacity: 6 },

    { id: "pod-1", name: "Workpod 1", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },
    { id: "pod-2", name: "Workpod 2", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },
    { id: "pod-3", name: "Workpod 3", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },
    { id: "pod-4", name: "Workpod 4", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },
    { id: "pod-5", name: "Workpod 5", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },
    { id: "pod-6", name: "Workpod 6", type: "Mini Workpod", location: "WHQ Office", capacity: 1 },

    { id: "disc-1", name: "Discussion Room 1", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-2", name: "Discussion Room 2", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-3", name: "Discussion Room 3", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-4", name: "Discussion Room 4", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-5", name: "Discussion Room 5", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-6", name: "Discussion Room 6", type: "Discussion Room", location: "WHQ", capacity: 6 },
    { id: "disc-7", name: "Discussion Room 7", type: "Discussion Room", location: "WHQ", capacity: 6 },
  ],
};
