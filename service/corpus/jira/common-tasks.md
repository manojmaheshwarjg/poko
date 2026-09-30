# Common tasks

## Make a role read only in a project

Goal: the role can still see everything, but cannot change issues.

1. Project settings, from the project rail.
2. Permissions.
3. Actions, then Edit permissions.
4. Leave Browse projects checked for that role, so they can still read.
5. Uncheck Edit issues for that role.

Uncheck only what the request asks for. Delete issues, add comments and
transition issues are separate permissions and are not implied by "cannot edit".
Removing more than was asked is a larger change than the person consented to.

If the request is meant to apply to this project only, and the Permissions screen
says the scheme is shared, use Copy scheme first and then edit the copy.

## Give a role access to a project

Project settings, then Access. This is membership, and is a different screen from
Permissions.

## Change a project's whole permission scheme

Project settings, Permissions, Actions, Use a different scheme. This swaps which
scheme the project points at. It is a much larger change than editing one
permission, because every rule in the scheme changes at once.

## Check what a role can currently do

Project settings, Permissions. The table is read only and shows the current state
per role. No menu needed.
