# Where things live

## Project settings is per project

The project rail (Backlog, Board, Issues, Project settings) is present on every
project screen. Project settings is the entry point for anything configuring this
one project.

Permissions are configured per project, reached through Project settings, not
through a global administration area. Looking for them in a global admin section
is the usual wrong turn.

## Inside Project settings

- **Details** is names and descriptions.
- **Access** is membership, who can reach the project.
- **Permissions** is what roles can do inside the project.
- **Notifications** is who gets emailed.

## The Permissions screen is read only

The Permissions screen displays the scheme currently associated with the project
as a table of permissions by role. Nothing on it can be edited directly.

Changes are behind the **Actions** menu in the top right of that screen. The menu
holds:

- **Edit permissions** changes the scheme that is currently associated, in place.
  Because schemes are shared, this affects every project using it.
- **Use a different scheme** leaves the current scheme untouched and associates a
  different existing scheme with this project.
- **Copy scheme** duplicates the current scheme so it can be changed without
  touching the original.

The menu is deliberate friction. It exists so that editing something shared is
never a single click from a read-only view.

## Edit permissions screen

A table of permissions by role, with a checkbox per cell. Each checkbox is
labelled with the permission and the role, for example "Edit issues for
Contractors". Checking grants, unchecking revokes. Changes apply to the scheme,
so they apply to every project using that scheme.

## There is no save step

Checkbox changes on the Edit permissions screen apply the moment they are
toggled. There is no Save button, no Apply, and no confirmation dialog anywhere
in this flow. A plan that ends by saving is describing a different product.

## Inside Access

Access lists every role with access to this project, how many people are in it,
and a Remove button per row, labelled with the role, for example "Remove
Contractors". Removing a role here takes away its access to this project only.
The role itself continues to exist and keeps its access to other projects.

There is also an Add people button for granting access.

## What this product cannot do

None of the following exist anywhere in this product: deleting or archiving a
project, renaming or deleting a role, creating a new permission type, scheduling
a change for later, undoing a change, and any history or audit of who changed
what. Nothing in the rail, in Project settings, or behind the Actions menu does
any of them.

A request for one of these has no route. Refuse it and say which part is
missing. Do not approximate it with the nearest available control, and do not
confuse it with something adjacent that does exist: removing a role's access to
this project is possible from Access, while deleting the role itself is not.
